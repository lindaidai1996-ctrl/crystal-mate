import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), material: vi.fn(), product: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: { material: { findUnique: mocks.material }, product: { findUnique: mocks.product } },
}));
import { GET as materialGET } from '@/app/api/materials/[id]/batch-comparison/route';
import { GET as productGET } from '@/app/api/products/[id]/batch-comparison/route';

const context = () => ({ params: Promise.resolve({ id: 'item' }) });
const request = (query = '') =>
  new NextRequest(`http://localhost/api/materials/item/batch-comparison${query}`);
const decimal = (value: string) => new Prisma.Decimal(value);
function materialEntry() {
  return {
    id: 'e',
    batchId: 'b',
    batch: { id: 'b', name: 'Batch', receivedAt: new Date('2026-11-01'), notes: 'Batch note' },
    distributor: { id: 'd', name: 'Distributor' },
    receivedQty: decimal('2'),
    remainingQty: decimal('1'),
    purchaseTotalAmount: decimal('40'),
    purchaseUnitPrice: decimal('15'),
    purchaseTotalWeightGrams: decimal('8'),
    purchaseGramPrice: decimal('5'),
    childCount: 10,
    childUnitPrice: decimal('1.5'),
    weightGrams: decimal('4'),
    lengthMm: decimal('6'),
    widthMm: null,
    heightMm: null,
    unitPriceSource: 'MANUAL',
    notes: '',
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'admin', name: 'admin' } });
});
describe('batch comparison read APIs', () => {
  it.each([materialGET, productGET])('authenticates before reading business data', async (get) => {
    mocks.auth.mockResolvedValue(null);
    expect((await get(request(), context())).status).toBe(401);
    expect(mocks.material).not.toHaveBeenCalled();
    expect(mocks.product).not.toHaveBeenCalled();
  });
  it.each([materialGET, productGET])('returns 404 for missing items', async (get) => {
    mocks.material.mockResolvedValue(null);
    mocks.product.mockResolvedValue(null);
    expect((await get(request(), context())).status).toBe(404);
  });
  it('rejects invalid filters before querying', async () => {
    expect(
      (await materialGET(request('?receivedFrom=2026-11-09&receivedTo=2026-11-01'), context()))
        .status,
    ).toBe(400);
    expect(mocks.material).not.toHaveBeenCalled();
  });
  it('prioritizes recorded amounts for trends but values current inventory at the stored unit cost', async () => {
    mocks.material.mockResolvedValue({
      id: 'item',
      name: 'Material',
      unit: 'STRAND',
      batchEntries: [materialEntry()],
    });
    const response = await materialGET(request(), context());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.batches[0].prices).toEqual({
      STRAND: '20.000000',
      GRAM: '5.000000',
      BEAD: '2.000000',
    });
    expect(result.batches[0].entries[0]).toMatchObject({
      amount: '40',
      priceSource: 'MANUAL',
      inventoryValue: '15.00',
      remainingPercent: '50.00',
      notes: 'Batch note',
    });
    expect(result.summary.inventoryValue.known).toBe('15.00');
  });
  it('uses grams directly and falls back to quantity times gram cost without multiplying weight again', async () => {
    mocks.material.mockResolvedValue({
      id: 'item',
      name: 'Powder',
      unit: 'GRAM',
      batchEntries: [
        {
          ...materialEntry(),
          receivedQty: decimal('12.50'),
          remainingQty: decimal('2.50'),
          purchaseTotalAmount: null,
          purchaseTotalWeightGrams: null,
          purchaseUnitPrice: null,
          purchaseGramPrice: decimal('3.20'),
        },
      ],
    });
    const result = await (await materialGET(request(), context())).json();
    expect(result.batches[0]).toMatchObject({
      quantity: '12.50',
      amount: '40.00',
      prices: { GRAM: '3.200000' },
    });
    expect(result.batches[0].entries[0].inventoryValue).toBe('8.00');
  });
  it('filters by distributor and received date while keeping all-history batch counts', async () => {
    mocks.material.mockResolvedValue({
      id: 'item',
      name: 'Material',
      unit: 'STRAND',
      batchEntries: [materialEntry()],
    });
    const result = await (await materialGET(request('?distributorId=other'), context())).json();
    expect(result.batches).toEqual([]);
    expect(result.totalBatchCount).toBe(1);
  });
  it('keeps a recorded zero amount and values depleted stock as zero even without a cost', async () => {
    mocks.material.mockResolvedValue({
      id: 'item',
      name: 'Material',
      unit: 'STRAND',
      batchEntries: [
        {
          ...materialEntry(),
          purchaseTotalAmount: decimal('0'),
          purchaseUnitPrice: null,
          remainingQty: decimal('0'),
        },
      ],
    });
    const result = await (await materialGET(request(), context())).json();
    expect(result.batches[0]).toMatchObject({ amount: '0.00', prices: { STRAND: '0.000000' } });
    expect(result.summary.inventoryValue).toEqual({ known: '0.00', missingCount: 0 });
  });
  it('combines multiple product purchases and never reads DIY runs or invents batch stock', async () => {
    const { batch, distributor } = materialEntry();
    mocks.product.mockResolvedValue({
      id: 'item',
      name: 'Product',
      stock: 9,
      purchaseEntries: [
        {
          id: 'e1',
          batchId: 'b',
          batch,
          distributor,
          quantity: 2,
          unitCost: decimal('10'),
          notes: 'Purchase row note',
        },
        {
          id: 'e2',
          batchId: 'b',
          batch,
          distributor,
          quantity: 3,
          unitCost: decimal('20'),
          notes: '',
        },
      ],
    });
    const result = await (await productGET(request(), context())).json();
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]).toMatchObject({
      quantity: '5.00',
      amount: '80.00',
      prices: { PIECE: '16.000000' },
    });
    expect(result.batches[0].entries[0].remainingQuantity).toBeNull();
    expect(result.batches[0].entries[0].notes).toBe('Purchase row note');
    expect(result.summary.currentStock.known).toBe('9.00');
    expect(mocks.product.mock.calls[0][0].include).not.toHaveProperty('diyRuns');
  });
});
