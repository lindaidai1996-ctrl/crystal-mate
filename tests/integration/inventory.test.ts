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
import { adjustMaterialStock } from '../../src/lib/material-stock';
import {
  createMaterial,
  createMaterialEntry,
  updateMaterialEntry,
  materialInclude,
  serializeMaterial,
} from '../../src/lib/materials';
import {
  addProductSource,
  adjustProductStock,
  updateProductSource,
  deleteProductSource,
} from '../../src/lib/product-sources';
import {
  materialCreateSchema,
  materialBatchEntrySchema,
  materialBatchEntryUpdateSchema,
} from '../../src/lib/validation';
import { emptyPurchase } from '../../src/lib/material-purchase';
import { MAX_STOCK } from '../../src/lib/inventory';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL ?? 'postgres://localhost/none').pathname.endsWith('_test');
afterAll(async () => {
  await db.$disconnect();
});

describe.skipIf(!enabled)('inventory transactions', () => {
  it('keeps physical counts independent from purchase history, validates corrections, and rolls back conflicts', async () => {
    const suffix = `inventory-${Date.now()}`;
    const category = await db.materialCategory.create({ data: { name: suffix } });
    const distributor = await db.distributor.create({ data: { name: suffix, area: 'test' } });
    const batches = await Promise.all(
      [0, 1, 2].map((i) =>
        db.materialBatch.create({ data: { name: `${suffix}-${i}`, receivedAt: new Date() } }),
      ),
    );
    let materialId: string | undefined;
    const values = {
      name: suffix,
      categoryId: category.id,
      unit: 'BEAD',
      purchaseUnitPrice: '10.00',
      weightGrams: '1.00',
      purchaseGramPrice: null,
      purchaseGramManual: false,
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
      mode: 'BATCH',
      totalAmount: '100.00',
      totalWeightGrams: '10.00',
    };
    const input = (receivedQty: number | null, name = suffix) =>
      materialBatchEntryUpdateSchema.parse({
        values: { ...values, name },
        receivedQty,
        purchase,
        distributorId: distributor.id,
      });
    try {
      const created = await createMaterial(
        materialCreateSchema.parse({
          values,
          receivedQty: 10,
          distributorId: distributor.id,
          selection: { batchId: batches[0].id },
        }),
      );
      materialId = created.id;
      const entryId = created.batchEntries[0].id;
      expect(created.knownStock).toBe(10);
      const counted = await adjustMaterialStock(materialId, entryId, {
        quantity: 7,
        expectedQuantity: 10,
        reason: '',
      });
      expect(counted).toMatchObject({
        receivedQty: 10,
        remainingQty: 7,
        stockAdjustments: [{ beforeQty: 10, afterQty: 7, delta: -3, reason: '手动盘点' }],
      });
      expect((await updateMaterialEntry(materialId, entryId, input(10))).remainingQty).toBe(7);
      expect((await updateMaterialEntry(materialId, entryId, input(12))).remainingQty).toBe(9);
      await expect(
        updateMaterialEntry(materialId, entryId, input(1, 'must rollback')),
      ).rejects.toMatchObject({ code: 'MATERIAL_STOCK_OUT_OF_RANGE' });
      expect((await db.material.findUniqueOrThrow({ where: { id: materialId } })).name).toBe(
        suffix,
      );
      expect(
        (
          await db.materialBatchEntry.findUniqueOrThrow({ where: { id: entryId } })
        ).remainingQty?.toNumber(),
      ).toBe(9);
      await expect(
        adjustMaterialStock(materialId, entryId, { quantity: 3, expectedQuantity: 7, reason: '' }),
      ).rejects.toMatchObject({ code: 'STOCK_CHANGED' });
      expect(await db.materialStockAdjustment.count({ where: { entryId } })).toBe(1);
      // The database must allow stock gains above the historical purchase count.
      await adjustMaterialStock(materialId, entryId, {
        quantity: 20,
        expectedQuantity: 9,
        reason: 'gain',
      });
      expect((await updateMaterialEntry(materialId, entryId, input(null))).remainingQty).toBe(20);
      expect((await updateMaterialEntry(materialId, entryId, input(15))).remainingQty).toBe(20);
      await adjustMaterialStock(materialId, entryId, {
        quantity: MAX_STOCK,
        expectedQuantity: 20,
        reason: '',
      });
      await expect(updateMaterialEntry(materialId, entryId, input(16))).rejects.toMatchObject({
        code: 'MATERIAL_STOCK_OUT_OF_RANGE',
      });
      await adjustMaterialStock(materialId, entryId, {
        quantity: 0,
        expectedQuantity: MAX_STOCK,
        reason: '',
      });
      const unknown = await createMaterialEntry(
        materialId,
        materialBatchEntrySchema.parse({
          values,
          receivedQty: null,
          purchase,
          distributorId: distributor.id,
          selection: { batchId: batches[1].id },
        }),
      );
      const pending = await createMaterialEntry(
        materialId,
        materialBatchEntrySchema.parse({
          values,
          receivedQty: null,
          purchase,
          distributorId: distributor.id,
          selection: { batchId: batches[2].id },
        }),
      );
      const firstCount = await adjustMaterialStock(materialId, unknown.id, {
        quantity: 8,
        expectedQuantity: null,
        reason: '',
      });
      expect(firstCount.stockAdjustments[0]).toMatchObject({
        beforeQty: null,
        afterQty: 8,
        delta: null,
      });
      expect((await updateMaterialEntry(materialId, unknown.id, input(30))).remainingQty).toBe(8);
      const read = () =>
        db.material
          .findUniqueOrThrow({ where: { id: materialId }, include: materialInclude })
          .then(serializeMaterial);
      expect(await read()).toMatchObject({ knownStock: 8, unknownStockBatchCount: 1 });
      // New purchases increase the summary without overwriting any counted batch.
      await updateMaterialEntry(materialId, pending.id, input(5));
      expect(await read()).toMatchObject({ knownStock: 13, unknownStockBatchCount: 0 });
      const results = await Promise.allSettled([
        adjustMaterialStock(materialId, unknown.id, {
          quantity: 6,
          expectedQuantity: 8,
          reason: 'count A',
        }),
        adjustMaterialStock(materialId, unknown.id, {
          quantity: 4,
          expectedQuantity: 8,
          reason: 'count B',
        }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'STOCK_CHANGED' },
      });
      expect(await db.materialStockAdjustment.count({ where: { entryId: unknown.id } })).toBe(2);
      await db.materialBatchEntry.delete({ where: { id: unknown.id } });
      expect(await db.materialStockAdjustment.count({ where: { entryId: unknown.id } })).toBe(0);
      expect(await read()).toMatchObject({ knownStock: 5 });
    } finally {
      if (materialId) {
        await db.materialBatchEntry.deleteMany({ where: { materialId } });
        await db.material.delete({ where: { id: materialId } });
      }
      await db.materialBatch.deleteMany({
        where: { id: { in: batches.map((batch) => batch.id) } },
      });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
    }
  });

  it('supports product actual counts and legacy deltas while preserving future purchase updates', async () => {
    const suffix = `inventory-product-${Date.now()}`;
    const category = await db.category.create({ data: { name: suffix } });
    const distributor = await db.distributor.create({ data: { name: suffix, area: 'test' } });
    const batch = await db.materialBatch.create({ data: { name: suffix, receivedAt: new Date() } });
    const product = await db.product.create({
      data: { categoryId: category.id, name: suffix, code: suffix, priceCents: 100, stock: 0 },
    });
    const input = (quantity: number) => ({
      origin: 'PURCHASED' as const,
      quantity,
      selection: { batchId: batch.id },
      distributorId: distributor.id,
      unitCost: '1.00',
      notes: '',
    });
    try {
      const initial = await addProductSource(product.id, input(10));
      const sourceId = initial.purchaseEntries[0].id;
      expect(initial.stock).toBe(10);
      const counted = await adjustProductStock(product.id, {
        quantity: 7,
        expectedQuantity: 10,
        reason: '',
      });
      expect(counted.stockAdjustments[0]).toMatchObject({
        beforeQty: 10,
        afterQty: 7,
        delta: -3,
        reason: '手动盘点',
      });
      const updated = await updateProductSource(product.id, sourceId, input(12));
      expect(updated.stock).toBe(9);
      await addProductSource(product.id, input(5));
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(14);
      await expect(
        adjustProductStock(product.id, { quantity: 2, expectedQuantity: 9, reason: '' }),
      ).rejects.toMatchObject({ code: 'STOCK_CHANGED' });
      expect((await adjustProductStock(product.id, { delta: -1, reason: 'legacy' })).stock).toBe(
        13,
      );
      expect((await deleteProductSource(product.id, sourceId)).stock).toBe(1);
      const results = await Promise.allSettled([
        adjustProductStock(product.id, { quantity: 3, expectedQuantity: 1, reason: 'count A' }),
        adjustProductStock(product.id, { quantity: 4, expectedQuantity: 1, reason: 'count B' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'STOCK_CHANGED' },
      });
      const current = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      const logs = await db.productStockAdjustment.count({ where: { productId: product.id } });
      await expect(
        adjustProductStock(product.id, { delta: -MAX_STOCK, reason: 'bad count' }),
      ).rejects.toMatchObject({ code: 'PRODUCT_STOCK_OUT_OF_RANGE' });
      expect(await db.productStockAdjustment.count({ where: { productId: product.id } })).toBe(
        logs,
      );
      expect(
        (
          await adjustProductStock(product.id, {
            quantity: 0,
            expectedQuantity: current.stock,
            reason: '',
          })
        ).stock,
      ).toBe(0);
    } finally {
      await db.productStockAdjustment.deleteMany({ where: { productId: product.id } });
      await db.productPurchaseEntry.deleteMany({ where: { productId: product.id } });
      await db.product.delete({ where: { id: product.id } });
      await db.category.delete({ where: { id: category.id } });
      await db.materialBatch.delete({ where: { id: batch.id } });
      await db.distributor.delete({ where: { id: distributor.id } });
    }
  });

  it('rolls back the stock write if its history insert fails', async () => {
    const suffix = `inventory-rollback-${Date.now()}`;
    const category = await db.materialCategory.create({ data: { name: suffix } });
    const distributor = await db.distributor.create({ data: { name: suffix, area: 'test' } });
    const batch = await db.materialBatch.create({ data: { name: suffix, receivedAt: new Date() } });
    const material = await db.material.create({
      data: { name: suffix, categoryId: category.id, unit: 'BEAD' },
    });
    const entry = await db.materialBatchEntry.create({
      data: {
        materialId: material.id,
        batchId: batch.id,
        distributorId: distributor.id,
        receivedQty: 10,
        remainingQty: 10,
      },
    });
    const trigger = 'inventory_test_reject_log';
    try {
      await db.$executeRawUnsafe(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'force rollback' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON "MaterialStockAdjustment" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
      );
      await expect(
        adjustMaterialStock(material.id, entry.id, {
          quantity: 3,
          expectedQuantity: 10,
          reason: 'force rollback',
        }),
      ).rejects.toThrow('test rollback');
      expect(
        (
          await db.materialBatchEntry.findUniqueOrThrow({ where: { id: entry.id } })
        ).remainingQty?.toNumber(),
      ).toBe(10);
      expect(await db.materialStockAdjustment.count({ where: { entryId: entry.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "MaterialStockAdjustment"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
      await db.materialBatchEntry.delete({ where: { id: entry.id } });
      await db.material.delete({ where: { id: material.id } });
      await db.materialBatch.delete({ where: { id: batch.id } });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
    }
  });
});
