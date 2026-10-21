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
import { adoptSaleUnitPriceFromBeads, editMaterial } from '../../src/lib/material-calculations';
import {
  createMaterial,
  materialInclude,
  serializeMaterial,
  updateMaterialEntry,
} from '../../src/lib/materials';
import { materialBatchEntryUpdateSchema, materialCreateSchema } from '../../src/lib/validation';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');

afterAll(() => db.$disconnect());

describe.skipIf(!enabled)('custom material sale prices', () => {
  it('saves, reloads and updates custom prices, then switches back to automatic pricing', async () => {
    const suffix = Date.now().toString(36);
    const category = await db.materialCategory.create({ data: { name: `售价验证${suffix}` } });
    const distributor = await db.distributor.create({
      data: { name: `售价验证${suffix}`, area: '网络' },
    });
    const batch = await db.materialBatch.create({
      data: { name: `售价验证${suffix}`, receivedAt: new Date() },
    });
    let materialId: string | undefined;
    try {
      const input = materialCreateSchema.parse({
        values: {
          name: `售价验证${suffix}`,
          categoryId: category.id,
          unit: 'STRAND',
          purchaseUnitPrice: '19.90',
          weightGrams: '20.00',
          purchaseGramPrice: null,
          purchaseGramManual: false,
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          childCount: 65,
          childWeightGrams: null,
          childUnitPrice: '0.31',
          childPriceSource: 'COUNT',
          saleRule: 'COST',
          saleRuleValue: null,
          saleUnitPrice: '19.90',
          saleGramPrice: null,
          saleChildUnitPrice: '3.00',
          saleUnitManual: false,
          saleGramManual: false,
          saleChildManual: true,
          notes: '',
          imageKeys: [],
        },
        selection: { batchId: batch.id },
        distributorId: distributor.id,
        receivedQty: 1,
      });
      input.values = { ...input.values, ...adoptSaleUnitPriceFromBeads(input.values) };
      const created = await createMaterial(input);
      materialId = created.id;
      const reloaded = serializeMaterial(
        await db.material.findUniqueOrThrow({
          where: { id: materialId },
          include: materialInclude,
        }),
      );
      expect(reloaded.batchEntries[0]).toMatchObject({
        saleRule: 'CUSTOM_AMOUNT',
        saleUnitPrice: '195.00',
        saleChildUnitPrice: '3.00',
        saleUnitManual: true,
        saleChildManual: true,
      });
      const entryId = reloaded.batchEntries[0].id;
      const changed = editMaterial(
        editMaterial(input.values, 'purchaseUnitPrice', '30.00'),
        'childCount',
        60,
      );
      const update = materialBatchEntryUpdateSchema.parse({
        values: { ...changed, imageKeys: [] },
        distributorId: distributor.id,
        receivedQty: 1,
      });
      expect(await updateMaterialEntry(materialId, entryId, update)).toMatchObject({
        saleRule: 'CUSTOM_AMOUNT',
        saleUnitPrice: '195.00',
        saleChildUnitPrice: '3.00',
        childCount: 60,
      });
      update.values = { ...update.values, ...editMaterial(changed, 'saleRule', 'PERCENT_20') };
      expect(await updateMaterialEntry(materialId, entryId, update)).toMatchObject({
        saleRule: 'PERCENT_20',
        saleUnitPrice: '36.00',
        saleChildUnitPrice: '0.60',
        saleUnitManual: false,
        saleChildManual: false,
      });
    } finally {
      if (materialId) {
        await db.materialBatchEntry.deleteMany({ where: { materialId } });
        await db.material.delete({ where: { id: materialId } });
      }
      await db.materialBatch.delete({ where: { id: batch.id } });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
    }
  });
});
