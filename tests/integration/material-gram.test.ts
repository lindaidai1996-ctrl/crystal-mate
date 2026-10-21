import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
import { db } from '../../src/lib/db';
import {
  createMaterial,
  createMaterialEntry,
  updateMaterialEntry,
  updateMaterialMaster,
  serializeMaterial,
  materialInclude,
} from '../../src/lib/materials';
import { adjustMaterialStock } from '../../src/lib/material-stock';
import {
  materialCreateSchema,
  materialBatchEntrySchema,
  materialBatchEntryUpdateSchema,
} from '../../src/lib/validation';
import { gramPayload } from '../fixtures/material-gram';
import {
  addProductSource,
  productSourceInclude,
  serializeProductSources,
} from '../../src/lib/product-sources';
import {
  getDistributorPurchaseEntries,
  getDistributorPurchaseSummary,
} from '../../src/lib/distributor-purchases';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL ?? 'postgres://localhost/none').pathname.endsWith('_test');
afterAll(async () => {
  await db.$disconnect();
});

describe.skipIf(!enabled)('gram material persistence', () => {
  it('round trips fractional weights, pricing, stock corrections, unit locks, and DIY usage', async () => {
    const suffix = `gram-${Date.now()}`;
    const category = await db.materialCategory.create({ data: { name: suffix } });
    const productCategory = await db.category.create({ data: { name: suffix } });
    const distributor = await db.distributor.create({ data: { name: suffix, area: 'test' } });
    const batches = await Promise.all(
      [0, 1].map((i) =>
        db.materialBatch.create({ data: { name: `${suffix}-${i}`, receivedAt: new Date() } }),
      ),
    );
    let materialId: string | undefined;
    let productId: string | undefined;
    try {
      const input = materialCreateSchema.parse({
        ...gramPayload(),
        values: { ...gramPayload().values, name: suffix, categoryId: category.id },
        receivedQty: 100.5,
        purchase: { ...gramPayload().purchase, totalWeightGrams: '100.50', totalAmount: '804.00' },
        distributorId: distributor.id,
        selection: { batchId: batches[0].id },
      });
      const created = await createMaterial(input);
      materialId = created.id;
      const entry = created.batchEntries[0];
      expect(created).toMatchObject({ unit: 'GRAM', knownStock: 100.5 });
      expect(entry).toMatchObject({
        receivedQty: 100.5,
        remainingQty: 100.5,
        purchaseUnitPrice: '8.00',
        purchaseGramPrice: '8.00',
        saleGramPrice: '12.00',
        saleUnitPrice: '12.00',
      });
      const counted = await adjustMaterialStock(materialId, entry.id, {
        quantity: 98,
        expectedQuantity: 100.5,
        reason: '使用 2.5 克',
      });
      expect(counted).toMatchObject({
        remainingQty: 98,
        stockAdjustments: [{ beforeQty: 100.5, afterQty: 98, delta: -2.5 }],
      });
      await expect(
        adjustMaterialStock(materialId, entry.id, {
          quantity: 97.5,
          expectedQuantity: 100.5,
          reason: '',
        }),
      ).rejects.toMatchObject({ code: 'STOCK_CHANGED' });
      const update = materialBatchEntryUpdateSchema.parse({
        values: input.values,
        distributorId: distributor.id,
        receivedQty: 101,
        purchase: { ...input.purchase, totalWeightGrams: '101.00', totalAmount: '808.00' },
      });
      expect(await updateMaterialEntry(materialId, entry.id, update)).toMatchObject({
        receivedQty: 101,
        remainingQty: 98.5,
      });
      await expect(
        updateMaterialMaster(materialId, {
          name: suffix,
          categoryId: category.id,
          unit: 'BEAD',
          notes: '',
        }),
      ).rejects.toMatchObject({ code: 'MATERIAL_UNIT_LOCKED' });
      await expect(
        updateMaterialEntry(materialId, entry.id, {
          ...update,
          values: { ...update.values, unit: 'BEAD' },
        }),
      ).rejects.toMatchObject({ code: 'MATERIAL_UNIT_LOCKED' });
      const { tagIds: _tagIds, ...entryInput } = input;
      void _tagIds;
      const appended = await createMaterialEntry(
        materialId,
        materialBatchEntrySchema.parse({
          ...entryInput,
          receivedQty: 0.25,
          purchase: { ...input.purchase, totalWeightGrams: '0.25', totalAmount: '2.00' },
          selection: { batchId: batches[1].id },
        }),
      );
      expect(appended.remainingQty).toBe(0.25);
      const reloaded = serializeMaterial(
        await db.material.findUniqueOrThrow({
          where: { id: materialId },
          include: materialInclude,
        }),
      );
      expect(reloaded.knownStock).toBe(98.75);
      const summary = await getDistributorPurchaseSummary(distributor.id, {
        type: 'material',
        q: '',
        page: 1,
        pageSize: 20,
      });
      expect(summary.items[0]).toMatchObject({
        unit: 'GRAM',
        knownQuantity: 101.25,
        totalAmount: '810.00',
        totalWeightGrams: '101.25',
      });
      const entries = await getDistributorPurchaseEntries(distributor.id, {
        type: 'material',
        itemId: materialId,
        page: 1,
        pageSize: 20,
      });
      expect(entries.items.find((item) => item.id === appended.id)?.quantity).toBe(0.25);
      const product = await db.product.create({
        data: {
          name: suffix,
          code: suffix,
          categoryId: productCategory.id,
          priceCents: 0,
          stock: 0,
        },
      });
      productId = product.id;
      const source = {
        origin: 'DIY' as const,
        quantity: 1,
        notes: '',
        materials: [
          {
            materialBatchEntryId: entry.id,
            usageUnit: 'GRAM' as const,
            quantity: '2.50',
            unitCost: '8.00',
            quoteUnitPrice: '12.00',
          },
        ],
        cabochons: [],
        extraCosts: [],
      };
      await addProductSource(product.id, source);
      const saved = serializeProductSources(
        await db.product.findUniqueOrThrow({
          where: { id: product.id },
          include: productSourceInclude,
        }),
      );
      expect(saved.diyRuns[0]).toMatchObject({
        perUnitCost: '20.00',
        perUnitQuote: '30.00',
        materialLines: [
          { quantity: '2.50', materialBatchEntry: { receivedQty: 101, remainingQty: 98.5 } },
        ],
      });
      await expect(
        addProductSource(product.id, {
          ...source,
          materials: [{ ...source.materials[0], usageUnit: 'BEAD' }],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(
        adjustMaterialStock(materialId, entry.id, {
          quantity: 98.555,
          expectedQuantity: 98.5,
          reason: '',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      const bead = await db.material.create({
        data: { name: `${suffix}-bead`, categoryId: category.id, unit: 'BEAD' },
      });
      try {
        const beadEntry = await db.materialBatchEntry.create({
          data: {
            materialId: bead.id,
            batchId: batches[0].id,
            distributorId: distributor.id,
            receivedQty: 2,
            remainingQty: 2,
          },
        });
        await expect(
          adjustMaterialStock(bead.id, beadEntry.id, {
            quantity: 1.5,
            expectedQuantity: 2,
            reason: '',
          }),
        ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      } finally {
        await db.materialBatchEntry.deleteMany({ where: { materialId: bead.id } });
        await db.material.delete({ where: { id: bead.id } });
      }
    } finally {
      if (productId) {
        await db.productDiyRun.deleteMany({ where: { productId } });
        await db.product.delete({ where: { id: productId } });
      }
      if (materialId) {
        await db.materialBatchEntry.deleteMany({ where: { materialId } });
        await db.material.delete({ where: { id: materialId } });
      }
      await db.materialBatch.deleteMany({ where: { id: { in: batches.map((item) => item.id) } } });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.category.delete({ where: { id: productCategory.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
    }
  });
});
