import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
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
  materialInclude,
  serializeMaterial,
} from '../../src/lib/materials';
import { emptyPurchase } from '../../src/lib/material-purchase';
import {
  materialCreateSchema,
  materialBatchEntrySchema,
  materialBatchEntryUpdateSchema,
} from '../../src/lib/validation';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');
afterAll(async () => {
  await db.$disconnect();
});

describe.skipIf(!enabled)('batch purchase persistence', () => {
  it('round trips unknown quantities, samples, manual overrides, count updates, and legacy entries', async () => {
    const suffix = Date.now().toString(36);
    const category = await db.materialCategory.create({ data: { name: `采购验证${suffix}` } });
    const distributor = await db.distributor.create({
      data: { name: `采购验证${suffix}`, area: '网络' },
    });
    const batches = await Promise.all(
      [1, 2, 3].map((index) =>
        db.materialBatch.create({
          data: {
            name: `采购验证${suffix}-${index}`,
            receivedAt: new Date('2026-10-14T00:00:00Z'),
          },
        }),
      ),
    );
    let materialId: string | undefined;
    try {
      const values = {
        name: `采购验证物料${suffix}`,
        categoryId: category.id,
        unit: 'BEAD',
        purchaseUnitPrice: '999.00',
        weightGrams: '999.00',
        purchaseGramPrice: '999.00',
        purchaseGramManual: true,
        lengthMm: null,
        widthMm: null,
        heightMm: null,
        childCount: null,
        childWeightGrams: null,
        childUnitPrice: null,
        childPriceSource: null,
        saleRule: 'COST',
        saleRuleValue: null,
        saleUnitPrice: null,
        saleGramPrice: null,
        saleChildUnitPrice: null,
        saleUnitManual: false,
        saleGramManual: false,
        saleChildManual: false,
        notes: '',
        imageKeys: [],
      };
      const purchase = {
        ...emptyPurchase(),
        mode: 'BATCH' as const,
        quotedGramPrice: '8.00',
        totalWeightGrams: '250.00',
        totalAmount: '1950.00',
        sampleWeightGrams: '0.50',
        unitInputs: { price: '9.00', weight: '1.00', gramPrice: '9.00', gramManual: false },
      };
      const created = await createMaterial(
        materialCreateSchema.parse({
          values,
          purchase,
          receivedQty: null,
          distributorId: distributor.id,
          selection: { batchId: batches[0].id },
        }),
      );
      materialId = created.id;
      const entry = created.batchEntries[0];
      expect(entry).toMatchObject({
        receivedQty: null,
        remainingQty: null,
        purchaseUnitPrice: '3.90',
        weightGrams: '0.50',
        purchaseGramPrice: '7.80',
        unitPriceSource: 'ESTIMATED',
        purchase,
      });
      const read = serializeMaterial(
        await db.material.findUniqueOrThrow({
          where: { id: materialId },
          include: materialInclude,
        }),
      );
      expect(read.batchEntries[0].purchase).toEqual(purchase);
      const update = (nextPurchase = purchase, receivedQty: number | null = null) =>
        materialBatchEntryUpdateSchema.parse({
          values,
          purchase: nextPurchase,
          receivedQty,
          distributorId: distributor.id,
        });
      const manual = await updateMaterialEntry(
        materialId,
        entry.id,
        update({ ...purchase, manualUnitPrice: '6.00' }),
      );
      expect(manual).toMatchObject({
        purchaseUnitPrice: '6.00',
        unitPriceSource: 'MANUAL',
        receivedQty: null,
      });
      const counted = await updateMaterialEntry(materialId, entry.id, update(purchase, 500));
      expect(counted).toMatchObject({
        purchaseUnitPrice: '3.90',
        weightGrams: '0.50',
        receivedQty: 500,
        remainingQty: 500,
        unitPriceSource: 'AVERAGE',
        purchase: { sampleWeightGrams: '0.50' },
      });
      const unknown = await updateMaterialEntry(materialId, entry.id, update());
      expect(unknown.receivedQty).toBeNull();
      const append = await createMaterialEntry(
        materialId,
        materialBatchEntrySchema.parse({
          values,
          purchase: { ...purchase, sampleWeightGrams: null },
          receivedQty: null,
          distributorId: distributor.id,
          selection: { batchId: batches[1].id },
        }),
      );
      expect(append).toMatchObject({
        receivedQty: null,
        remainingQty: null,
        purchaseUnitPrice: null,
        weightGrams: null,
        purchaseGramPrice: '7.80',
        unitPriceSource: 'UNKNOWN',
      });
      const legacy = await createMaterialEntry(
        materialId,
        materialBatchEntrySchema.parse({
          values,
          receivedQty: 10,
          distributorId: distributor.id,
          selection: { batchId: batches[2].id },
        }),
      );
      expect(legacy).toMatchObject({
        receivedQty: 10,
        purchaseUnitPrice: '999.00',
        purchase: { mode: 'UNIT', totalAmount: null, totalWeightGrams: null },
      });
      await expect(
        db.materialBatchEntry.update({
          where: { id: legacy.id },
          data: { receivedQty: null, remainingQty: null },
        }),
      ).rejects.toThrow();
      await expect(
        db.materialBatchEntry.update({ where: { id: append.id }, data: { remainingQty: 1 } }),
      ).rejects.toThrow();
    } finally {
      if (materialId) {
        await db.materialBatchEntry.deleteMany({ where: { materialId } });
        await db.material.delete({ where: { id: materialId } });
      }
      await db.materialBatch.deleteMany({ where: { id: { in: batches.map((item) => item.id) } } });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
    }
  });
});
