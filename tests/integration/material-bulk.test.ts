import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/auth', () => ({ auth: vi.fn() }));
import { db } from '../../src/lib/db';
import {
  deleteMaterialBulk,
  materialBulkError,
  previewMaterialBulk,
  updateMaterialBulk,
} from '../../src/lib/material-bulk-service';
import { materialBulkUpdateSchema } from '../../src/lib/material-bulk';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/no').pathname.endsWith('_test');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => db.$disconnect());

async function fixture() {
  const prefix = `bulk-${crypto.randomUUID()}`;
  const category = await db.materialCategory.create({ data: { name: prefix } });
  const otherCategory = await db.materialCategory.create({ data: { name: `${prefix}-other` } });
  const distributor = await db.distributor.create({ data: { name: prefix, area: '网络' } });
  const otherDistributor = await db.distributor.create({
    data: { name: `${prefix}-other`, area: '网络' },
  });
  const batches = await Promise.all(
    [0, 1, 2].map((index) =>
      db.materialBatch.create({ data: { name: `${prefix}-${index}`, receivedAt: new Date() } }),
    ),
  );
  const bead = await db.material.create({
    data: { name: `${prefix}-bead`, categoryId: category.id, unit: 'BEAD', notes: 'preserve' },
  });
  const gram = await db.material.create({
    data: { name: `${prefix}-gram`, categoryId: category.id, unit: 'GRAM' },
  });
  const empty = await db.material.create({
    data: { name: `${prefix}-empty`, categoryId: category.id, unit: 'STRAND' },
  });
  const entries = await Promise.all([
    db.materialBatchEntry.create({
      data: {
        materialId: bead.id,
        batchId: batches[0].id,
        distributorId: distributor.id,
        receivedQty: 10,
        remainingQty: 5,
        purchaseUnitPrice: '10.01',
        purchaseGramPrice: '2.00',
        purchaseGramManual: true,
        saleUnitPrice: '99.00',
        saleUnitManual: true,
      },
    }),
    db.materialBatchEntry.create({
      data: {
        materialId: bead.id,
        batchId: batches[1].id,
        distributorId: distributor.id,
        receivedQty: 20,
        remainingQty: 15,
      },
    }),
    db.materialBatchEntry.create({
      data: {
        materialId: gram.id,
        batchId: batches[0].id,
        distributorId: distributor.id,
        receivedQty: 20.5,
        remainingQty: 10.25,
        purchaseUnitPrice: '8.00',
        purchaseGramPrice: '8.00',
      },
    }),
  ]);
  const ids = [bead.id, gram.id, empty.id];
  cleanups.push(async () => {
    const products = await db.product.findMany({
      where: { name: { startsWith: prefix } },
      select: { id: true },
    });
    await db.productDiyRun.deleteMany({ where: { productId: { in: products.map((p) => p.id) } } });
    await db.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } });
    await db.category.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.materialImageImport.deleteMany({ where: { fileName: prefix } });
    await db.materialBatchEntry.deleteMany({ where: { materialId: { in: ids } } });
    await db.material.deleteMany({ where: { id: { in: ids } } });
    await db.tag.deleteMany({ where: { name: prefix } });
    await db.materialBatch.deleteMany({ where: { id: { in: batches.map((b) => b.id) } } });
    await db.distributor.deleteMany({
      where: { id: { in: [distributor.id, otherDistributor.id] } },
    });
    await db.materialCategory.deleteMany({
      where: { id: { in: [category.id, otherCategory.id] } },
    });
  });
  return {
    prefix,
    category,
    otherCategory,
    distributor,
    otherDistributor,
    batches,
    bead,
    gram,
    empty,
    entries,
    ids,
  };
}

async function errorBody(operation: Promise<unknown>) {
  try {
    await operation;
    throw new Error('expected a rejection');
  } catch (error) {
    return materialBulkError(error).json();
  }
}

describe.skipIf(!enabled)('bulk material transactions', () => {
  it('updates only enabled fields and selected entries, preserving purchase history', async () => {
    const f = await fixture();
    const preview = await previewMaterialBulk(f.ids);
    const result = await updateMaterialBulk(
      materialBulkUpdateSchema.parse({
        snapshot: preview.snapshot,
        entryIds: [f.entries[0].id, f.entries[2].id],
        changes: {
          categoryId: f.otherCategory.id,
          distributorId: f.otherDistributor.id,
          stock: { mode: 'ADD', quantities: { BEAD: 2, GRAM: 0.25 } },
          sale: { rule: 'PERCENT_50' },
        },
      }),
    );
    expect(result).toEqual({ materialCount: 3, entryCount: 2 });
    const saved = await db.materialBatchEntry.findUniqueOrThrow({
      where: { id: f.entries[0].id },
      include: { stockAdjustments: true },
    });
    expect(saved.remainingQty?.toNumber()).toBe(7);
    expect(saved.receivedQty?.toNumber()).toBe(10);
    expect(saved.purchaseUnitPrice?.toFixed(2)).toBe('10.01');
    expect(saved.saleUnitPrice?.toFixed(2)).toBe('16.00');
    expect(saved.saleUnitManual).toBe(false);
    expect(saved.distributorId).toBe(f.otherDistributor.id);
    expect(saved.stockAdjustments).toHaveLength(1);
    expect(saved.stockAdjustments[0].delta?.toNumber()).toBe(2);
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: f.entries[2].id } })
      ).remainingQty?.toNumber(),
    ).toBe(10.5);
    const untouched = await db.materialBatchEntry.findUniqueOrThrow({
      where: { id: f.entries[1].id },
    });
    expect(untouched.remainingQty?.toNumber()).toBe(15);
    expect(untouched.distributorId).toBe(f.distributor.id);
    expect(untouched.updatedAt).toEqual(f.entries[1].updatedAt);
    expect(
      await db.material.count({ where: { id: { in: f.ids }, categoryId: f.otherCategory.id } }),
    ).toBe(3);
    expect((await db.material.findUniqueOrThrow({ where: { id: f.bead.id } })).notes).toBe(
      'preserve',
    );
  });

  it('allows category-only changes without batches and rejects foreign target IDs', async () => {
    const f = await fixture();
    const preview = await previewMaterialBulk([f.empty.id]);
    await updateMaterialBulk({
      snapshot: preview.snapshot,
      entryIds: [],
      changes: { categoryId: f.otherCategory.id },
    });
    expect((await db.material.findUniqueOrThrow({ where: { id: f.empty.id } })).categoryId).toBe(
      f.otherCategory.id,
    );
    const latest = await previewMaterialBulk([f.empty.id]);
    const response = await errorBody(
      updateMaterialBulk({
        snapshot: latest.snapshot,
        entryIds: [f.entries[0].id],
        changes: { categoryId: f.category.id },
      }),
    );
    expect(response.error).toBe('INVALID_INPUT');
    expect((await db.material.findUniqueOrThrow({ where: { id: f.empty.id } })).categoryId).toBe(
      f.otherCategory.id,
    );
  });

  it('rolls back the entire batch for unknown stock and invalid resulting stock', async () => {
    const f = await fixture();
    await db.materialBatchEntry.update({
      where: { id: f.entries[2].id },
      data: { remainingQty: null },
    });
    let preview = await previewMaterialBulk(f.ids);
    const failed = await errorBody(
      updateMaterialBulk({
        snapshot: preview.snapshot,
        entryIds: [f.entries[0].id, f.entries[2].id],
        changes: {
          categoryId: f.otherCategory.id,
          stock: { mode: 'ADD', quantities: { BEAD: 1, GRAM: 1 }, reason: '' },
        },
      }),
    );
    expect(failed.issues[0].code).toBe('UNKNOWN_STOCK');
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: f.entries[0].id } })
      ).remainingQty?.toNumber(),
    ).toBe(5);
    expect((await db.material.findUniqueOrThrow({ where: { id: f.bead.id } })).categoryId).toBe(
      f.category.id,
    );
    expect(await db.materialStockAdjustment.count({ where: { entryId: f.entries[0].id } })).toBe(0);
    await updateMaterialBulk({
      snapshot: preview.snapshot,
      entryIds: [f.entries[2].id],
      changes: { stock: { mode: 'SET', quantities: { GRAM: 0 }, reason: 'count' } },
    });
    preview = await previewMaterialBulk(f.ids);
    const negative = await errorBody(
      updateMaterialBulk({
        snapshot: preview.snapshot,
        entryIds: [f.entries[0].id, f.entries[2].id],
        changes: { stock: { mode: 'SUBTRACT', quantities: { BEAD: 1, GRAM: 1 }, reason: '' } },
      }),
    );
    expect(negative.issues[0].code).toBe('STOCK_OUT_OF_RANGE');
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: f.entries[0].id } })
      ).remainingQty?.toNumber(),
    ).toBe(5);
  });

  it('moves entries without changing history and rejects existing and intra-request collisions', async () => {
    const f = await fixture();
    let preview = await previewMaterialBulk(f.ids);
    const existing = await errorBody(
      updateMaterialBulk({
        snapshot: preview.snapshot,
        entryIds: [f.entries[0].id],
        changes: { batchId: f.batches[1].id, categoryId: f.otherCategory.id },
      }),
    );
    expect(existing.issues[0].code).toBe('BATCH_CONFLICT');
    expect((await db.material.findUniqueOrThrow({ where: { id: f.bead.id } })).categoryId).toBe(
      f.category.id,
    );
    const duplicate = await errorBody(
      updateMaterialBulk({
        snapshot: preview.snapshot,
        entryIds: [f.entries[0].id, f.entries[1].id],
        changes: { batchId: f.batches[2].id },
      }),
    );
    expect(duplicate.issues).toHaveLength(2);
    await updateMaterialBulk({
      snapshot: preview.snapshot,
      entryIds: [f.entries[0].id, f.entries[2].id],
      changes: { batchId: f.batches[2].id },
    });
    preview = await previewMaterialBulk(f.ids);
    expect(
      preview.items
        .flatMap((item) => item.batchEntries)
        .filter((entry) => entry.batchId === f.batches[2].id),
    ).toHaveLength(2);
    expect(
      preview.items
        .find((item) => item.id === f.bead.id)
        ?.batchEntries.find((entry) => entry.id === f.entries[0].id)?.receivedQty,
    ).toBe(10);
  });

  it('rejects stale snapshots for editing and deletion, including added entries', async () => {
    const f = await fixture();
    const preview = await previewMaterialBulk(f.ids);
    await db.materialBatchEntry.update({
      where: { id: f.entries[0].id },
      data: { remainingQty: 4, updatedAt: new Date(Date.now() + 1000) },
    });
    expect(
      (
        await errorBody(
          updateMaterialBulk({
            snapshot: preview.snapshot,
            entryIds: [f.entries[0].id],
            changes: { stock: { mode: 'ADD', quantities: { BEAD: 2 }, reason: '' } },
          }),
        )
      ).error,
    ).toBe('BULK_CHANGED');
    expect((await errorBody(deleteMaterialBulk(preview.snapshot))).error).toBe('BULK_CHANGED');
    const fresh = await previewMaterialBulk(f.ids);
    await db.materialBatchEntry.create({
      data: {
        materialId: f.empty.id,
        batchId: f.batches[0].id,
        distributorId: f.distributor.id,
        receivedQty: 1,
        remainingQty: 1,
      },
    });
    expect((await errorBody(deleteMaterialBulk(fresh.snapshot))).issues[0].code).toBe('CHANGED');
    expect(await db.material.count({ where: { id: { in: f.ids } } })).toBe(3);
  });

  it('commits only one of two concurrent stock adjustments from the same snapshot', async () => {
    const f = await fixture();
    const preview = await previewMaterialBulk(f.ids);
    const input = {
      snapshot: preview.snapshot,
      entryIds: [f.entries[0].id],
      changes: { stock: { mode: 'ADD' as const, quantities: { BEAD: 2 }, reason: '' } },
    };
    const results = await Promise.allSettled([
      updateMaterialBulk(input),
      updateMaterialBulk(input),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected')
      expect((await materialBulkError(rejected.reason).json()).error).toBe('BULK_CHANGED');
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: f.entries[0].id } })
      ).remainingQty?.toNumber(),
    ).toBe(7);
    expect(await db.materialStockAdjustment.count({ where: { entryId: f.entries[0].id } })).toBe(1);
  });

  it('rolls back earlier writes when a later database write fails', async () => {
    const f = await fixture();
    const preview = await previewMaterialBulk(f.ids);
    const trigger = `bulk_failure_${crypto.randomUUID().replaceAll('-', '')}`;
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected write failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON "Material" FOR EACH ROW WHEN (NEW.id = '${f.bead.id}') EXECUTE FUNCTION ${trigger}()`,
    );
    try {
      await expect(
        updateMaterialBulk({
          snapshot: preview.snapshot,
          entryIds: [f.entries[0].id],
          changes: { stock: { mode: 'ADD', quantities: { BEAD: 2 }, reason: '' } },
        }),
      ).rejects.toThrow('injected write failure');
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "Material"`);
      await db.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`);
    }
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: f.entries[0].id } })
      ).remainingQty?.toNumber(),
    ).toBe(5);
    expect(await db.materialStockAdjustment.count({ where: { entryId: f.entries[0].id } })).toBe(0);
  });

  it('deletes dependent records while retaining purchase batches, distributors and import sources', async () => {
    const f = await fixture();
    const tag = await db.tag.create({ data: { name: f.prefix } });
    await db.materialTag.create({ data: { materialId: f.bead.id, tagId: tag.id } });
    await db.materialImage.create({
      data: {
        materialId: f.bead.id,
        objectKey: `${f.prefix}/master.png`,
        url: '/master.png',
        position: 0,
      },
    });
    await db.materialBatchImage.create({
      data: {
        entryId: f.entries[0].id,
        objectKey: `${f.prefix}/batch.png`,
        url: '/batch.png',
        position: 0,
      },
    });
    await db.materialStockAdjustment.create({
      data: { entryId: f.entries[0].id, beforeQty: 10, afterQty: 5, delta: -5, reason: 'count' },
    });
    const source = await db.materialImageImport.create({
      data: {
        sourceKey: f.prefix,
        sourceUrl: '/source.png',
        fileName: f.prefix,
        width: 100,
        height: 100,
        provider: 'test',
        model: 'test',
        promptVersion: 'test',
        settings: {},
        warnings: [],
        items: {
          create: {
            position: 0,
            data: { original: 'preserve' },
            materialId: f.bead.id,
            entryId: f.entries[0].id,
          },
        },
      },
      include: { items: true },
    });
    const preview = await previewMaterialBulk(f.ids);
    await deleteMaterialBulk(preview.snapshot);
    expect(await db.material.count({ where: { id: { in: f.ids } } })).toBe(0);
    expect(await db.materialBatchEntry.count({ where: { materialId: { in: f.ids } } })).toBe(0);
    expect(await db.materialStockAdjustment.count({ where: { entryId: f.entries[0].id } })).toBe(0);
    expect(await db.materialBatchImage.count({ where: { entryId: f.entries[0].id } })).toBe(0);
    expect(await db.materialImage.count({ where: { materialId: f.bead.id } })).toBe(0);
    expect(await db.materialTag.count({ where: { materialId: f.bead.id } })).toBe(0);
    expect(
      await db.materialBatch.count({ where: { id: { in: f.batches.map((batch) => batch.id) } } }),
    ).toBe(3);
    expect(await db.distributor.findUnique({ where: { id: f.distributor.id } })).not.toBeNull();
    expect(
      await db.materialImageImportItem.findUnique({ where: { id: source.items[0].id } }),
    ).toMatchObject({ materialId: null, entryId: null, data: { original: 'preserve' } });
    expect(await db.materialImageImport.findUnique({ where: { id: source.id } })).not.toBeNull();
  });

  it('blocks the entire deletion when any material is referenced by DIY production', async () => {
    const f = await fixture();
    const category = await db.category.create({ data: { name: f.prefix } });
    const product = await db.product.create({
      data: { code: f.prefix, name: f.prefix, categoryId: category.id, priceCents: 100 },
    });
    await db.productDiyRun.create({
      data: {
        productId: product.id,
        quantity: 1,
        perUnitCost: '1.00',
        materialLines: {
          create: {
            materialBatchEntryId: f.entries[0].id,
            usageUnit: 'BEAD',
            quantity: 1,
            unitCost: 1,
            lineCost: 1,
            position: 0,
          },
        },
      },
    });
    const preview = await previewMaterialBulk(f.ids);
    expect(preview.deleteBlockers).toEqual([
      { materialId: f.bead.id, name: f.bead.name, code: 'DIY_IN_USE' },
    ]);
    const response = await errorBody(deleteMaterialBulk(preview.snapshot));
    expect(response.issues).toEqual(preview.deleteBlockers);
    expect(await db.material.count({ where: { id: { in: f.ids } } })).toBe(3);
    expect(await db.materialBatchEntry.count({ where: { materialId: { in: f.ids } } })).toBe(3);
  });
});
