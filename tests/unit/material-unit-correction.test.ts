import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMaterial } from '../../src/lib/material-defaults';
import { auditContext } from '../../src/lib/audit-context';
import { calculatePurchase } from '../../src/lib/material-purchase';
import type { MaterialValues } from '../../src/lib/client-types';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  read: vi.fn(),
  writeMaster: vi.fn(),
  writeEntry: vi.fn(),
  writeAdjustment: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
import { POST, PATCH } from '../../src/app/api/materials/[id]/unit-correction/route';
import {
  correctMaterialUnit,
  previewUnitCorrection,
} from '../../src/lib/material-unit-correction-service';

const decimal = (value: string | number) => new Prisma.Decimal(value);
function fixture() {
  const pricing = {
    ...emptyMaterial(),
    name: '测试物料',
    unit: 'STRAND' as const,
    purchaseUnitPrice: decimal(2),
    weightGrams: decimal(3),
    purchaseGramPrice: decimal('0.67'),
    childCount: 20,
    childWeightGrams: decimal('0.15'),
    childUnitPrice: decimal('0.10'),
    childPriceSource: 'COUNT',
    baseSaleUnitPrice: decimal(3),
    baseSaleGramPrice: decimal(1),
    baseSaleChildUnitPrice: decimal('0.15'),
    saleUnitPrice: decimal(4),
    saleGramPrice: decimal('1.33'),
    saleChildUnitPrice: decimal('0.20'),
  };
  const entry = {
    ...pricing,
    id: 'entry-1',
    materialId: 'material-1',
    batchId: 'batch-1',
    distributorId: 'distributor-1',
    receivedQty: decimal(100),
    remainingQty: decimal(80),
    purchaseInputMode: 'UNIT',
    purchaseTotalAmount: null as Prisma.Decimal | null,
    purchaseTotalWeightGrams: null as Prisma.Decimal | null,
    purchaseQuotedGramPrice: null,
    purchaseAutoField: null,
    sampleWeightGrams: null,
    manualPurchaseUnitPrice: null,
    purchaseUnitInputs: { price: '2.00', weight: '3.00', gramPrice: '0.67', gramManual: false },
    unitPriceSource: 'UNIT',
    batch: { name: '批次一' },
    distributor: { name: '渠道商一' },
    stockAdjustments: [
      {
        id: 'adjustment-1',
        beforeQty: decimal(100),
        afterQty: decimal(80),
        createdAt: new Date('2026-11-19T00:00:00Z'),
        reason: '盘点',
      },
    ],
    diyLines: [] as {
      id: string;
      usageUnit: 'STRAND' | 'BEAD' | 'GRAM';
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      quoteSnapshot: object;
      run: { product: { id: string; name: string } };
    }[],
    updatedAt: new Date('2026-11-19T00:00:00Z'),
  };
  return {
    ...pricing,
    id: 'material-1',
    batchEntries: [entry],
    updatedAt: new Date('2026-11-19T00:00:00Z'),
  };
}
let item: ReturnType<typeof fixture>;
const tx = {
  material: { findUnique: mocks.read, update: mocks.writeMaster },
  materialBatchEntry: { update: mocks.writeEntry },
  materialStockAdjustment: { update: mocks.writeAdjustment },
};
const context = { params: Promise.resolve({ id: 'material-1' }) };
const request = (method: string, body: unknown, origin = 'http://localhost') =>
  new NextRequest('http://localhost/api/materials/material-1/unit-correction', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  item = fixture();
  mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
  mocks.read.mockImplementation(async () => item);
  mocks.transaction.mockImplementation(async (fn) => fn(tx));
});

describe('material unit correction', () => {
  it('previews every batch and cleared child prices without writing', async () => {
    item.batchEntries.push({ ...item.batchEntries[0], id: 'entry-2' });
    const preview = await previewUnitCorrection(item.id, 'BEAD');
    expect(preview.entries).toHaveLength(2);
    expect(preview.entries[0]).toMatchObject({
      receivedQty: '100.00',
      remainingQty: '80.00',
      purchaseUnitPrice: '2.00',
      saleUnitPrice: '4.00',
      adjustmentCount: 1,
    });
    expect(preview.masterChanges).toContainEqual({
      field: 'baseSaleChildUnitPrice',
      before: '0.15',
      after: null,
    });
    expect(mocks.writeMaster).not.toHaveBeenCalled();
    expect(mocks.writeEntry).not.toHaveBeenCalled();
  });
  it('corrects all batches while preserving quantities, main prices, stock history and DIY snapshots', async () => {
    item.batchEntries[0].diyLines.push({
      id: 'line',
      usageUnit: 'BEAD',
      quantity: decimal(3),
      unitCost: decimal('0.1'),
      quoteSnapshot: { price: '0.2' },
      run: { product: { id: 'product-1', name: '商品一' } },
    });
    item.batchEntries.push({ ...item.batchEntries[0], id: 'entry-2' });
    const preview = await previewUnitCorrection(item.id, 'BEAD');
    await correctMaterialUnit(item.id, 'BEAD', preview.snapshot);
    expect(mocks.writeEntry).toHaveBeenCalledTimes(2);
    const patch = mocks.writeEntry.mock.calls[0][0].data;
    expect(patch).toMatchObject({
      childCount: null,
      baseSaleChildUnitPrice: null,
      purchaseUnitInputs: Prisma.DbNull,
    });
    for (const field of ['stockAdjustments', 'diyLines']) expect(patch).not.toHaveProperty(field);
    expect(patch.receivedQty.toFixed(2)).toBe('100.00');
    expect(patch.remainingQty.toFixed(2)).toBe('80.00');
    expect(patch.purchaseUnitPrice.toFixed(2)).toBe('2.00');
    expect(patch.saleUnitPrice.toFixed(2)).toBe('4.00');
    expect(mocks.writeAdjustment).not.toHaveBeenCalled();
    expect(mocks.writeMaster.mock.calls[0][0].data.unit).toBe('BEAD');
    expect(mocks.transaction.mock.calls.at(-1)?.[1]).toEqual({ isolationLevel: 'Serializable' });
  });
  it('allows unknown stock and zero stock without inventing quantities', async () => {
    Object.assign(item.batchEntries[0], { receivedQty: null, remainingQty: decimal(0) });
    const preview = await previewUnitCorrection(item.id, 'BEAD');
    await correctMaterialUnit(item.id, 'BEAD', preview.snapshot);
    expect(mocks.writeEntry.mock.calls[0][0].data.receivedQty).toBeNull();
  });
  it.each(['receivedQty', 'remainingQty', 'history'] as const)(
    'blocks fractional %s when leaving grams',
    async (field) => {
      Object.assign(item, { unit: 'GRAM' });
      if (field === 'history') item.batchEntries[0].stockAdjustments[0].beforeQty = decimal('1.5');
      else item.batchEntries[0][field] = decimal('1.5');
      const initial = await previewUnitCorrection(item.id, 'BEAD');
      const edits = structuredClone(initial.edits);
      if (field !== 'history') edits.entries[0][field] = '1.5';
      const preview = await previewUnitCorrection(item.id, 'BEAD', edits);
      expect(preview.entries[0].issues).toContain('QUANTITY');
      await expect(
        correctMaterialUnit(item.id, 'BEAD', preview.snapshot, preview.edits),
      ).rejects.toMatchObject({
        code: 'MATERIAL_UNIT_CONFLICT',
      });
      expect(mocks.writeEntry).not.toHaveBeenCalled();
    },
  );
  it.each(['BEAD', 'GRAM'] as const)('blocks incompatible DIY usage for %s', async (target) => {
    item.batchEntries[0].diyLines.push({
      id: 'line',
      usageUnit: 'STRAND',
      quantity: decimal(1),
      unitCost: decimal(2),
      quoteSnapshot: {},
      run: { product: { id: 'product-1', name: '商品一' } },
    });
    const preview = await previewUnitCorrection(item.id, target);
    expect(preview.entries[0].diy[0]).toMatchObject({ productId: 'product-1', conflict: true });
    await expect(correctMaterialUnit(item.id, target, preview.snapshot)).rejects.toMatchObject({
      code: 'MATERIAL_UNIT_CONFLICT',
    });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
  });
  it.each(['stock', 'batch', 'diy'] as const)(
    'rejects a stale preview after a %s change, even without a material timestamp change',
    async (field) => {
      const preview = await previewUnitCorrection(item.id, 'BEAD');
      if (field === 'stock') item.batchEntries[0].remainingQty = decimal(79);
      if (field === 'batch') item.batchEntries.push({ ...item.batchEntries[0], id: 'entry-2' });
      if (field === 'diy')
        item.batchEntries[0].diyLines.push({
          id: 'line',
          usageUnit: 'BEAD',
          quantity: decimal(1),
          unitCost: decimal(2),
          quoteSnapshot: {},
          run: { product: { id: 'product-1', name: '商品一' } },
        });
      await expect(correctMaterialUnit(item.id, 'BEAD', preview.snapshot)).rejects.toMatchObject({
        code: 'MATERIAL_UNIT_CHANGED',
      });
      expect(mocks.writeEntry).not.toHaveBeenCalled();
    },
  );
  it('uses existing grams and gram prices when counts and per-bead prices are unknown (reported case)', async () => {
    Object.assign(item, { unit: 'BEAD' });
    Object.assign(item.batchEntries[0], {
      receivedQty: null,
      remainingQty: null,
      purchaseUnitPrice: null,
      saleUnitPrice: null,
      purchaseInputMode: 'BATCH',
      purchaseTotalWeightGrams: decimal(10),
      purchaseTotalAmount: decimal(65),
      purchaseGramPrice: decimal('6.50'),
      baseSaleGramPrice: decimal(20),
      saleGramPrice: decimal(20),
    });
    const preview = await previewUnitCorrection(item.id, 'GRAM');
    expect(preview.edits.entries[0]).toMatchObject({
      receivedQty: '10.00',
      remainingQty: null,
      purchaseUnitPrice: '6.50',
      purchaseTotalAmount: '65.00',
      saleUnitPrice: '20.00',
      baseSaleUnitPrice: '20.00',
    });
    expect(preview.entries[0].issues).toEqual([]);
    await correctMaterialUnit(item.id, 'GRAM', preview.snapshot, preview.edits);
    const patch = mocks.writeEntry.mock.calls[0][0].data;
    expect(patch.purchaseTotalAmount.toFixed(2)).toBe('65.00');
    expect(patch.purchaseTotalWeightGrams.toFixed(2)).toBe('10.00');
    expect(patch.purchaseGramPrice.toFixed(2)).toBe('6.50');
    expect(patch.saleGramPrice.toFixed(2)).toBe('20.00');
    expect(patch.remainingQty).toBeNull();
    const result = calculatePurchase(
      {
        ...emptyMaterial(),
        unit: 'GRAM',
        purchaseUnitPrice: '6.50',
        purchaseGramPrice: '6.50',
        saleGramPrice: '20.00',
        baseSaleGramPrice: '20.00',
        baseSaleUnitPrice: '20.00',
        baseSaleChildUnitPrice: null,
        saleRule: 'CUSTOM_AMOUNT',
        saleRuleValue: null,
      },
      {
        mode: 'BATCH',
        totalWeightGrams: '10.00',
        totalAmount: '65.00',
        quotedGramPrice: null,
        autoField: null,
        sampleWeightGrams: null,
        manualUnitPrice: null,
        unitInputs: null,
      },
      10,
    );
    expect(result.valid).toBe(true);
    expect(result.values.purchaseUnitPrice).toBe('6.50');
    expect(result.values.baseSaleGramPrice).toBe('20.00');
    expect(result.values.saleUnitPrice).toBe('20.00');
  });
  it('accepts re-entered weights, stock and prices after an incomplete gram proposal', async () => {
    Object.assign(item, { unit: 'BEAD' });
    Object.assign(item.batchEntries[0], {
      receivedQty: null,
      remainingQty: null,
      purchaseUnitPrice: null,
      purchaseGramPrice: null,
      purchaseTotalAmount: null,
    });
    const initial = await previewUnitCorrection(item.id, 'GRAM');
    expect(initial.entries[0].issues).toContain('RECEIVED');
    const edits = structuredClone(initial.edits);
    Object.assign(edits.entries[0], {
      receivedQty: '12.50',
      remainingQty: '8.75',
      purchaseTotalAmount: '81.25',
      purchaseUnitPrice: null,
      saleUnitPrice: '20.00',
      baseSaleUnitPrice: '20.00',
    });
    const preview = await previewUnitCorrection(item.id, 'GRAM', edits);
    expect(preview.edits.entries[0].purchaseUnitPrice).toBe('6.50');
    expect(preview.entries[0].issues).toEqual([]);
    await correctMaterialUnit(item.id, 'GRAM', preview.snapshot, preview.edits);
    const patch = mocks.writeEntry.mock.calls[0][0].data;
    expect(patch.receivedQty.toFixed(2)).toBe('12.50');
    expect(patch.remainingQty.toFixed(2)).toBe('8.75');
    expect(patch.purchaseTotalAmount.toFixed(2)).toBe('81.25');
    expect(patch.saleGramPrice.toFixed(2)).toBe('20.00');
  });
  it('derives a missing purchase total from the entered gram price', async () => {
    const initial = await previewUnitCorrection(item.id, 'GRAM');
    const edits = structuredClone(initial.edits);
    Object.assign(edits.entries[0], {
      receivedQty: '10',
      purchaseTotalAmount: null,
      purchaseUnitPrice: '6.5',
    });
    const preview = await previewUnitCorrection(item.id, 'GRAM', edits);
    expect(preview.edits.entries[0].purchaseTotalAmount).toBe('65.00');
    expect(preview.entries[0].issues).toEqual([]);
    await correctMaterialUnit(item.id, 'GRAM', preview.snapshot, preview.edits);
  });
  it('lets the user refill count quantities and historic fractional counts when leaving grams', async () => {
    Object.assign(item, { unit: 'GRAM' });
    item.batchEntries[0].stockAdjustments[0].beforeQty = decimal('1.5');
    item.batchEntries[0].stockAdjustments[0].afterQty = decimal('1.2');
    const initial = await previewUnitCorrection(item.id, 'BEAD');
    const edits = structuredClone(initial.edits);
    Object.assign(edits.entries[0], {
      receivedQty: '30',
      remainingQty: '24',
      purchaseUnitPrice: '2.00',
      purchaseTotalAmount: '60.00',
      weightGrams: '0.05',
      saleUnitPrice: '4.00',
    });
    Object.assign(edits.entries[0].adjustments[0], { beforeQty: '30', afterQty: '24' });
    const preview = await previewUnitCorrection(item.id, 'BEAD', edits);
    expect(preview.entries[0].issues).toEqual([]);
    await correctMaterialUnit(item.id, 'BEAD', preview.snapshot, preview.edits);
    const history = mocks.writeAdjustment.mock.calls[0][0];
    expect(history.where).toEqual({ id: 'adjustment-1' });
    expect(history.data.delta.toFixed(2)).toBe('-6.00');
    expect(history.data).not.toHaveProperty('reason');
    expect(history.data).not.toHaveProperty('createdAt');
    const patch = mocks.writeEntry.mock.calls[0][0].data;
    expect(patch.receivedQty.toFixed(2)).toBe('30.00');
    const result = calculatePurchase(
      {
        ...emptyMaterial(),
        unit: 'BEAD',
        purchaseUnitPrice: '2.00',
        weightGrams: '0.05',
      } as MaterialValues,
      {
        mode: 'BATCH',
        totalWeightGrams: '1.50',
        totalAmount: '60.00',
        quotedGramPrice: null,
        autoField: null,
        sampleWeightGrams: '0.05',
        manualUnitPrice: '2.00',
        unitInputs: null,
      },
      30,
    );
    expect(result.valid).toBe(true);
    expect(result.values.purchaseUnitPrice).toBe('2.00');
    expect(result.values.weightGrams).toBe('0.05');
  });
  it('blocks inconsistent costs but allows the user to repair them in the same correction', async () => {
    item.batchEntries[0].purchaseTotalAmount = decimal(999);
    const initial = await previewUnitCorrection(item.id, 'GRAM');
    expect(initial.entries[0].issues).toContain('COST_MISMATCH');
    const edits = structuredClone(initial.edits);
    edits.entries[0].purchaseUnitPrice = null;
    const preview = await previewUnitCorrection(item.id, 'GRAM', edits);
    expect(preview.edits.entries[0].purchaseUnitPrice).toBe('9.99');
    expect(preview.entries[0].issues).toEqual([]);
    await correctMaterialUnit(item.id, 'GRAM', preview.snapshot, preview.edits);
  });
  it('binds the preview to the filled values, rejecting changes without a fresh preview', async () => {
    const preview = await previewUnitCorrection(item.id, 'BEAD');
    const edited = structuredClone(preview.edits);
    edited.entries[0].remainingQty = '79';
    await expect(
      correctMaterialUnit(item.id, 'BEAD', preview.snapshot, edited),
    ).rejects.toMatchObject({ code: 'MATERIAL_UNIT_CHANGED' });
    expect(mocks.writeEntry).not.toHaveBeenCalled();
    const fresh = await previewUnitCorrection(item.id, 'BEAD', edited);
    await correctMaterialUnit(item.id, 'BEAD', fresh.snapshot, fresh.edits);
    expect(mocks.writeEntry.mock.calls[0][0].data.remainingQty.toFixed(2)).toBe('79.00');
  });
  it.each(['entry', 'history', 'duplicate'] as const)(
    'rejects foreign or incomplete correction targets: %s',
    async (kind) => {
      const initial = await previewUnitCorrection(item.id, 'BEAD');
      const edits = structuredClone(initial.edits);
      if (kind === 'entry') edits.entries[0].id = 'another-entry';
      if (kind === 'history') edits.entries[0].adjustments[0].id = 'another-history';
      if (kind === 'duplicate') edits.entries.push(edits.entries[0]);
      await expect(previewUnitCorrection(item.id, 'BEAD', edits)).rejects.toMatchObject({
        code: 'MATERIAL_UNIT_CHANGED',
      });
      expect(mocks.writeEntry).not.toHaveBeenCalled();
    },
  );
  it('requires authentication, origin validation and explicit confirmation', async () => {
    for (const [method, handler] of [
      ['POST', POST],
      ['PATCH', PATCH],
    ] as const) {
      mocks.auth.mockResolvedValue(null);
      expect((await handler(request(method, {}), context)).status).toBe(401);
      mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin' } });
      expect((await handler(request(method, {}, 'http://other.test'), context)).status).toBe(403);
    }
    expect(
      (await PATCH(request('PATCH', { unit: 'BEAD', snapshot: 'a'.repeat(64) }), context)).status,
    ).toBe(400);
    expect((await POST(request('POST', { unit: 'BEAD', quantity: 1 }), context)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('binds all writes to the authenticated correction audit operation', async () => {
    const preview = await previewUnitCorrection(item.id, 'BEAD');
    let operationId: string | undefined;
    mocks.writeEntry.mockImplementation(() => {
      const ctx = auditContext.getStore();
      expect(ctx?.actor?.id).toBe('admin-id');
      expect(ctx?.source).toBe('PATCH /api/materials/material-1/unit-correction');
      operationId = ctx?.operationId;
    });
    mocks.writeMaster.mockImplementation(() => {
      expect(auditContext.getStore()?.operationId).toBe(operationId);
    });
    const result = await PATCH(
      request('PATCH', { unit: 'BEAD', snapshot: preview.snapshot, confirmed: true }),
      context,
    );
    expect(result.status).toBe(200);
    expect(operationId).toBeTruthy();
  });
  it('reports serialization conflicts without retrying or claiming success', async () => {
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '6.12.0',
      }),
    );
    const result = await PATCH(
      request('PATCH', { unit: 'BEAD', snapshot: 'a'.repeat(64), confirmed: true }),
      context,
    );
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'MATERIAL_UNIT_CHANGED' });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
