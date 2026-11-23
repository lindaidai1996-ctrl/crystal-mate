import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('@/auth', () => ({ auth: vi.fn() }));
import { db } from '../../src/lib/db';
import { emptyMaterial } from '../../src/lib/material-defaults';
import { emptyPurchase } from '../../src/lib/material-purchase';
import {
  editMaterial,
  initializeMaterialPricing,
  lossCompensatedPrice,
} from '../../src/lib/material-calculations';
import {
  createMaterial,
  createMaterialEntry,
  updateMaterialEntry,
  updateMaterialMaster,
  materialInclude,
  serializeMaterial,
} from '../../src/lib/materials';
import {
  materialCreateSchema,
  materialBatchEntrySchema,
  materialBatchEntryUpdateSchema,
} from '../../src/lib/validation';
import { suggestedMaterialQuote } from '../../src/lib/product-diy-quote';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/no').pathname.endsWith('_test');
afterAll(() => db.$disconnect());

describe.skipIf(!enabled)('persisted material loss pricing', () => {
  it('round-trips separate bases and actual prices, snapshots defaults and retains purchase amounts and stock', async () => {
    const prefix = `loss-${crypto.randomUUID()}`;
    const category = await db.materialCategory.create({ data: { name: prefix } });
    const distributor = await db.distributor.create({ data: { name: prefix, area: '网络' } });
    const batches = await Promise.all(
      [0, 1, 2].map((i) =>
        db.materialBatch.create({
          data: { name: `${prefix}-${i}`, receivedAt: new Date() },
        }),
      ),
    );
    let materialId: string | undefined;
    try {
      let values = editMaterial(
        initializeMaterialPricing({
          ...emptyMaterial(),
          name: prefix,
          categoryId: category.id,
          unit: 'BEAD',
          saleRule: 'PERCENT_30',
          purchaseUnitPrice: '100.00',
          lossRate: '10.00',
        }),
        'saleUnitPrice',
        '144.45',
      );
      const created = await createMaterial(
        materialCreateSchema.parse({
          values: { ...values, imageKeys: [] },
          selection: { batchId: batches[0].id },
          distributorId: distributor.id,
          receivedQty: 100,
          purchase: { ...emptyPurchase(), mode: 'BATCH', totalAmount: '10000.00' },
        }),
      );
      materialId = created.id;
      expect(created.lossRate).toBe('10.00');
      const first = created.batchEntries[0];
      expect(first).toMatchObject({
        baseSaleUnitPrice: '130.00',
        saleUnitPrice: '144.45',
        lossRate: '10.00',
        purchaseUnitPrice: '100.00',
        receivedQty: 100,
        remainingQty: 100,
      });
      expect(first.purchase.totalAmount).toBe('10000.00');
      values = editMaterial(values, 'lossRate', '20.00');
      const updated = await updateMaterialEntry(
        materialId,
        first.id,
        materialBatchEntryUpdateSchema.parse({
          values: { ...values, imageKeys: [] },
          distributorId: distributor.id,
          receivedQty: 100,
          purchase: first.purchase,
        }),
      );
      expect(updated).toMatchObject({
        baseSaleUnitPrice: '130.00',
        saleUnitPrice: '162.50',
        lossRate: '20.00',
        remainingQty: 100,
      });
      expect(updated.purchase.totalAmount).toBe('10000.00');
      expect(lossCompensatedPrice(updated.baseSaleUnitPrice, updated.lossRate)).toBe('162.50');
      await updateMaterialMaster(materialId, {
        name: prefix,
        categoryId: category.id,
        unit: 'BEAD',
        notes: '',
        lossRate: '15.00',
      });
      const { lossRate: _rate, ...withoutRate } = values;
      void _rate;
      const second = await createMaterialEntry(
        materialId,
        materialBatchEntrySchema.parse({
          values: { ...withoutRate, imageKeys: [] },
          selection: { batchId: batches[1].id },
          distributorId: distributor.id,
          receivedQty: 5,
        }),
      );
      const third = await createMaterialEntry(
        materialId,
        materialBatchEntrySchema.parse({
          values: { ...withoutRate, lossRate: null, imageKeys: [] },
          selection: { batchId: batches[2].id },
          distributorId: distributor.id,
          receivedQty: 5,
        }),
      );
      expect(second.lossRate).toBe('15.00');
      expect(third.lossRate).toBeNull();
      const reloaded = serializeMaterial(
        await db.material.findUniqueOrThrow({
          where: { id: materialId },
          include: materialInclude,
        }),
      );
      expect(reloaded.batchEntries.find((e) => e.id === first.id)?.lossRate).toBe('20.00');
      expect(reloaded.lossRate).toBe('15.00');
      expect(suggestedMaterialQuote({ material: { unit: 'BEAD' }, entry: second }, 'BEAD')).toBe(
        '162.50',
      );
    } finally {
      if (materialId) {
        await db.materialBatchEntry.deleteMany({ where: { materialId } });
        await db.material.delete({ where: { id: materialId } });
      }
      await db.materialBatch.deleteMany({ where: { id: { in: batches.map((b) => b.id) } } });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
    }
  });
});
