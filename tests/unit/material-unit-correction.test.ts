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
    stockAdjustments: [{ beforeQty: decimal(100), afterQty: decimal(80) }],
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
    for (const field of [
      'receivedQty',
      'remainingQty',
      'purchaseUnitPrice',
      'saleUnitPrice',
      'stockAdjustments',
      'diyLines',
    ])
      expect(patch).not.toHaveProperty(field);
    expect(mocks.writeMaster.mock.calls[0][0].data.unit).toBe('BEAD');
    expect(mocks.transaction.mock.calls.at(-1)?.[1]).toEqual({ isolationLevel: 'Serializable' });
  });
  it('allows unknown stock and zero stock without inventing quantities', async () => {
    Object.assign(item.batchEntries[0], { receivedQty: null, remainingQty: decimal(0) });
    const preview = await previewUnitCorrection(item.id, 'BEAD');
    await correctMaterialUnit(item.id, 'BEAD', preview.snapshot);
    expect(mocks.writeEntry.mock.calls[0][0].data).not.toHaveProperty('receivedQty');
  });
  it.each(['receivedQty', 'remainingQty', 'history'] as const)(
    'blocks fractional %s when leaving grams',
    async (field) => {
      Object.assign(item, { unit: 'GRAM' });
      if (field === 'history') item.batchEntries[0].stockAdjustments[0].beforeQty = decimal('1.5');
      else item.batchEntries[0][field] = decimal('1.5');
      const preview = await previewUnitCorrection(item.id, 'BEAD');
      expect(preview.entries[0].issues).toContain('QUANTITY');
      await expect(correctMaterialUnit(item.id, 'BEAD', preview.snapshot)).rejects.toMatchObject({
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
  it('normalizes grams with unchanged main price and an editable batch purchase', async () => {
    const preview = await previewUnitCorrection(item.id, 'GRAM');
    await correctMaterialUnit(item.id, 'GRAM', preview.snapshot);
    const patch = mocks.writeEntry.mock.calls[0][0].data;
    expect(patch.purchaseTotalAmount.toFixed(2)).toBe('200.00');
    expect(patch.purchaseTotalWeightGrams.toFixed(2)).toBe('100.00');
    expect(patch.purchaseGramPrice.toFixed(2)).toBe('2.00');
    expect(patch.saleGramPrice.toFixed(2)).toBe('4.00');
    const result = calculatePurchase(
      {
        ...emptyMaterial(),
        unit: 'GRAM',
        purchaseUnitPrice: '2.00',
        purchaseGramPrice: '2.00',
        saleGramPrice: '4.00',
      },
      {
        mode: 'BATCH',
        totalWeightGrams: '100.00',
        totalAmount: '200.00',
        quotedGramPrice: '2.00',
        autoField: null,
        sampleWeightGrams: null,
        manualUnitPrice: null,
        unitInputs: null,
      },
      100,
    );
    expect(result.valid).toBe(true);
    expect(result.values.purchaseUnitPrice).toBe('2.00');
  });
  it('clears false gram weights when correcting grams to a count unit', async () => {
    Object.assign(item, { unit: 'GRAM' });
    Object.assign(item.batchEntries[0], {
      purchaseTotalAmount: decimal(67),
      purchaseTotalWeightGrams: decimal(100),
    });
    const preview = await previewUnitCorrection(item.id, 'BEAD');
    await correctMaterialUnit(item.id, 'BEAD', preview.snapshot);
    const patch = mocks.writeEntry.mock.calls[0][0].data;
    expect(patch).toMatchObject({
      weightGrams: null,
      purchaseGramPrice: null,
      purchaseTotalWeightGrams: null,
      purchaseQuotedGramPrice: null,
    });
    expect(patch.purchaseUnitPrice.toFixed(2)).toBe('0.67');
    const result = calculatePurchase(
      {
        ...emptyMaterial(),
        unit: 'BEAD',
        purchaseUnitPrice: '0.67',
        purchaseGramPrice: null,
        weightGrams: null,
      } as MaterialValues,
      {
        mode: 'BATCH',
        totalWeightGrams: null,
        totalAmount: '67.00',
        quotedGramPrice: null,
        autoField: null,
        sampleWeightGrams: null,
        manualUnitPrice: '0.67',
        unitInputs: null,
      },
      100,
    );
    expect(result.valid).toBe(true);
    expect(result.values.purchaseUnitPrice).toBe('0.67');
  });
  it('blocks gram correction when total amount and main unit price disagree', async () => {
    item.batchEntries[0].purchaseTotalAmount = decimal(999);
    const preview = await previewUnitCorrection(item.id, 'GRAM');
    expect(preview.entries[0].issues).toContain('GRAM_PURCHASE');
    await expect(correctMaterialUnit(item.id, 'GRAM', preview.snapshot)).rejects.toMatchObject({
      code: 'MATERIAL_UNIT_CONFLICT',
    });
  });
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
