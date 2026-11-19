import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assistantQuerySchema } from '../../src/lib/ai-assistant/contracts';
import type { CandidateDetail } from '../../src/lib/ai-assistant/candidate-contracts';
import { stockQuerySchema, stockResultSchema } from '../../src/lib/ai-assistant/stock-contracts';
import { correctedRemainingQuantity } from '../../src/lib/inventory';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  scope: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  material: { findMany: vi.fn(), update: vi.fn() },
  product: { findMany: vi.fn() },
  materialBatchEntry: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
  materialStockAdjustment: { create: vi.fn() },
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('../../src/lib/ai-assistant/candidate-data', () => ({
  readAssistantCandidates: mocks.scope,
}));
import { readAssistantStock } from '../../src/lib/ai-assistant/stock-data';
import { queryAssistantStock } from '../../src/lib/ai-assistant/stock-service';
import { adjustMaterialStock } from '../../src/lib/material-stock';

const id = (n: number) => `c${n.toString().padStart(24, '0')}`;
const item = { type: 'MATERIAL' as const, id: id(1) };
const purchase = { type: 'MATERIAL_PURCHASE' as const, id: id(11) };
const query = assistantQuerySchema.parse({
  version: 'v1',
  subject: 'purchases',
  itemTypes: ['MATERIAL'],
  hard: {
    purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
    distributorIds: [id(90)],
  },
  semantic: [],
  ruleVersion: 'v1',
  pagination: { limit: 1 },
});
const current = { mode: 'catalog_current' as const, query };
const source = { mode: 'purchase_remaining' as const, query };
const detail = (entryId = purchase.id, materialId = item.id): CandidateDetail => ({
  candidate: {
    item: { ...item, id: materialId },
    purchase: { ...purchase, id: entryId },
    evidence: [],
  },
  code: null,
  batch: { type: 'BATCH', id: id(51) },
  distributor: { type: 'DISTRIBUTOR', id: id(90) },
});
const decimal = (value: number | null) => (value === null ? null : new Prisma.Decimal(value));
const entry = (
  n: number,
  remaining: number | null,
  received: number | null = 10,
  materialId = item.id,
) => ({
  id: id(n),
  materialId,
  batchId: id(51),
  receivedQty: decimal(received),
  remainingQty: decimal(remaining),
});
const tx = { ...mocks, $executeRaw: mocks.execute } as unknown as Prisma.TransactionClient;
const request = new NextRequest('http://localhost/api/assistant/stock');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'account-a', name: 'admin', nickname: '' } });
  mocks.scope.mockResolvedValue([detail()]);
  mocks.material.findMany.mockResolvedValue([{ id: item.id, name: '物料', unit: 'BEAD' }]);
  mocks.product.findMany.mockResolvedValue([]);
  mocks.materialBatchEntry.findMany.mockResolvedValue([
    entry(11, 2),
    entry(12, 4),
    entry(13, null),
    entry(14, 0),
  ]);
  mocks.transaction.mockImplementation((fn) => fn(tx));
});

describe('stock contracts', () => {
  it('accepts historical object selection and explicit empty selections', () => {
    expect(stockQuerySchema.parse({ ...current, selectedPurchases: [] }).selectedPurchases).toEqual(
      [],
    );
    expect(stockQuerySchema.parse({ ...current, selectedPurchases: [purchase] }).mode).toBe(
      'catalog_current',
    );
  });
  it.each([
    { ...source, query: { ...query, itemTypes: ['PRODUCT'] } },
    { ...source, query: { ...query, subject: 'catalog', hard: {} } },
    { ...current, selectedItems: [item] },
    { ...current, selectedPurchases: [purchase, purchase] },
    { ...current, selectedPurchases: [{ ...purchase, id: 'invalid' }] },
    { ...current, selectedPurchases: [{ type: 'PRODUCT_PURCHASE', id: id(22) }] },
    { ...current, ownerId: id(1) },
    { ...current, query: { ...query, hard: { ...query.hard, sql: 'SELECT' } } },
    {
      ...current,
      query: {
        ...query,
        pagination: {
          limit: 1,
          cursor: {
            runId: '03f862ce-bd15-4ca2-9fe9-6c2128bc8ced',
            scopeKey: 'a'.repeat(64),
            after: purchase,
          },
        },
      },
    },
  ])('rejects unsupported or forged input %#', (input) => {
    expect(stockQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('current stock facts', () => {
  it('reads corrected material units again without converting stored stock numbers', async () => {
    mocks.material.findMany.mockResolvedValue([{ id: item.id, name: '物料', unit: 'STRAND' }]);
    const before = await readAssistantStock(tx, current);
    mocks.material.findMany.mockResolvedValue([{ id: item.id, name: '物料', unit: 'BEAD' }]);
    const after = await readAssistantStock(tx, current);
    expect(before.quantities[0]).toMatchObject({ unit: 'STRAND', knownStock: '6.00' });
    expect(after.quantities[0]).toMatchObject({ unit: 'BEAD', knownStock: '6.00' });
    mocks.materialBatchEntry.findMany.mockResolvedValue([entry(11, 2)]);
    expect((await readAssistantStock(tx, source)).sourceStock[0]).toMatchObject({
      unit: 'BEAD',
      purchasedQuantity: '10.00',
      remainingQuantity: '2.00',
    });
  });
  it('keeps purchased 10, source remaining 2, all stock 6 and one unknown distinct', async () => {
    const all = await readAssistantStock(tx, current);
    expect(all.catalogStock[0]).toMatchObject({
      knownStock: '6.00',
      unknownStockBatchCount: 1,
      stockBatchCount: 4,
    });
    expect(mocks.materialBatchEntry.findMany.mock.calls[0][0].where).toEqual({
      materialId: { in: [item.id] },
    });
    mocks.materialBatchEntry.findMany.mockResolvedValue([entry(11, 2)]);
    const selected = await readAssistantStock(tx, { ...source, selectedPurchases: [purchase] });
    expect(selected.sourceStock[0]).toMatchObject({
      purchasedQuantity: '10.00',
      remainingQuantity: '2.00',
    });
    expect(selected.quantities[0]).toMatchObject({
      knownStock: '2.00',
      unknownStockObjectCount: 0,
    });
    expect(mocks.materialBatchEntry.findMany.mock.calls[1][0].where).toEqual({
      id: { in: [purchase.id] },
    });
  });
  it('counts a material once when multiple historical purchases selected, regardless of page limit', async () => {
    mocks.scope.mockResolvedValue([detail(), detail(id(12))]);
    const result = await readAssistantStock(tx, current);
    expect(result).toMatchObject({
      scopeCandidateCount: 2,
      selectedCandidateCount: 2,
      catalogItemCount: 1,
    });
    expect(result.catalogStock).toHaveLength(1);
    const remaining = await readAssistantStock(tx, source);
    expect(remaining.sourceStock).toHaveLength(2);
    expect(remaining.quantities[0].knownStock).toBe('6.00');
  });
  it.each([null, 0])('preserves source unknown versus zero: %s', async (qty) => {
    mocks.materialBatchEntry.findMany.mockResolvedValue([entry(11, qty, null)]);
    const result = await readAssistantStock(tx, source);
    expect(result.sourceStock[0]).toMatchObject({
      purchasedQuantity: null,
      remainingQuantity: qty === null ? null : '0.00',
    });
    expect(result.quantities[0]).toMatchObject({
      knownStock: '0.00',
      unknownStockBatchCount: Number(qty === null),
      unknownStockObjectCount: Number(qty === null),
    });
  });
  it('separates units, decimal quantities, and product stock from source purchase totals', async () => {
    const product = { type: 'PRODUCT' as const, id: id(3) };
    const catalogQuery = {
      ...query,
      subject: 'catalog',
      hard: {},
      itemTypes: ['MATERIAL', 'PRODUCT'],
    };
    mocks.scope.mockResolvedValue([
      { ...detail(), candidate: { item, purchase: null, evidence: [] } },
      { ...detail(), candidate: { item: { ...item, id: id(2) }, purchase: null, evidence: [] } },
      { ...detail(), candidate: { item: product, purchase: null, evidence: [] } },
    ]);
    mocks.material.findMany.mockResolvedValue([
      { id: item.id, name: '颗', unit: 'BEAD' },
      { id: id(2), name: '克', unit: 'GRAM' },
    ]);
    mocks.product.findMany.mockResolvedValue([{ id: product.id, name: '商品', stock: 7 }]);
    mocks.materialBatchEntry.findMany.mockResolvedValue([
      entry(11, 2),
      entry(21, 0.1, 4, id(2)),
      entry(22, 0.2, 8, id(2)),
    ]);
    const result = await readAssistantStock(tx, { ...current, query: catalogQuery });
    expect(result.quantities.map((r) => [r.unit, r.knownStock])).toEqual([
      ['BEAD', '2.00'],
      ['GRAM', '0.30'],
      ['PIECE', '7.00'],
    ]);
    expect(result.catalogStock[2].stockBatchCount).toBeNull();
    expect(result.semanticEvaluation).toBe('not_performed');
  });
  it('returns known zero for an existing material with no batches', async () => {
    mocks.materialBatchEntry.findMany.mockResolvedValue([]);
    const result = await readAssistantStock(tx, current);
    expect(result.catalogStock[0]).toMatchObject({
      knownStock: '0.00',
      stockBatchCount: 0,
      unknownStockBatchCount: 0,
    });
  });
  it('does not treat all-unknown stock as complete zero', async () => {
    mocks.materialBatchEntry.findMany.mockResolvedValue([entry(11, null), entry(12, null)]);
    const result = await readAssistantStock(tx, current);
    expect(result.catalogStock[0]).toMatchObject({ knownStock: '0.00', unknownStockBatchCount: 2 });
    expect(result.quantities[0]).toMatchObject({
      unknownStockObjectCount: 1,
      unknownStockBatchCount: 2,
    });
  });
  it.each([[[]], [[purchase]]])(
    'does not expand an explicit selection %j',
    async (selectedPurchases) => {
      const result = await readAssistantStock(tx, { ...current, selectedPurchases });
      expect(result.catalogItemCount).toBe(selectedPurchases.length);
      if (!selectedPurchases.length) expect(result.quantities).toEqual([]);
    },
  );
  it('validates catalog selection membership', async () => {
    mocks.scope.mockResolvedValue([
      { ...detail(), candidate: { item, purchase: null, evidence: [] } },
    ]);
    const input = {
      ...current,
      query: { ...query, subject: 'catalog', hard: {} },
      selectedItems: [item],
    };
    expect((await readAssistantStock(tx, input)).catalogItemCount).toBe(1);
    await expect(
      readAssistantStock(tx, { ...input, selectedItems: [{ ...item, id: id(2) }] }),
    ).rejects.toMatchObject({ code: 'STOCK_SELECTION_OUTSIDE_SCOPE' });
  });
  it('rejects purchase selection outside the validated hard scope', async () => {
    await expect(
      readAssistantStock(tx, { ...source, selectedPurchases: [{ ...purchase, id: id(99) }] }),
    ).rejects.toMatchObject({ code: 'STOCK_SELECTION_OUTSIDE_SCOPE' });
    expect(mocks.materialBatchEntry.findMany).not.toHaveBeenCalled();
  });
  it('propagates reference, location and database failures without fabricating an empty result', async () => {
    for (const code of [
      'REFERENCE_NOT_FOUND',
      'LOCATION_NEEDS_CLARIFICATION',
      'CANDIDATE_BUDGET_EXCEEDED',
    ]) {
      mocks.scope.mockRejectedValueOnce(new Error(code));
      await expect(readAssistantStock(tx, current)).rejects.toThrow(code);
    }
    mocks.materialBatchEntry.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(readAssistantStock(tx, current)).rejects.toThrow('database unavailable');
  });
  it.each(['missing', 'wrong material', 'wrong batch'])(
    'rejects source relation changes: %s',
    async (scenario) => {
      mocks.materialBatchEntry.findMany.mockResolvedValue(
        scenario === 'missing'
          ? []
          : [
              {
                ...entry(11, 2),
                ...(scenario === 'wrong batch' ? { batchId: id(99) } : { materialId: id(99) }),
              },
            ],
      );
      await expect(readAssistantStock(tx, source)).rejects.toMatchObject({
        code: 'STOCK_SNAPSHOT_CHANGED',
      });
    },
  );
  it('rejects stock scan truncation and a disappeared catalog object', async () => {
    mocks.materialBatchEntry.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, (_, n) => entry(100 + n, 1)),
    );
    await expect(readAssistantStock(tx, current)).rejects.toMatchObject({
      code: 'STOCK_BUDGET_EXCEEDED',
    });
    mocks.materialBatchEntry.findMany.mockResolvedValue([]);
    mocks.material.findMany.mockResolvedValue([]);
    await expect(readAssistantStock(tx, current)).rejects.toMatchObject({
      code: 'STOCK_SNAPSHOT_CHANGED',
    });
  });
  it('reflects consumed balance and received-quantity correction without restoring the consumed amount', async () => {
    const balance = correctedRemainingQuantity({ receivedQty: 10, remainingQty: 2 }, 12);
    mocks.materialBatchEntry.findMany.mockResolvedValue([entry(11, balance, 12)]);
    const result = await readAssistantStock(tx, source);
    expect(result.sourceStock[0]).toMatchObject({
      purchasedQuantity: '12.00',
      remainingQuantity: '4.00',
    });
  });
  it.each([2, null])(
    'reads the real stock adjustment result from prior balance %s without replaying its delta',
    async (before) => {
      const state = {
        ...entry(11, before),
        material: { unit: 'BEAD' },
        batch: { id: id(51) },
        stockAdjustments: [],
        images: [],
      };
      mocks.materialBatchEntry.findUnique.mockImplementation(async () => ({ ...state }));
      mocks.materialBatchEntry.updateMany.mockImplementation(async ({ data }) => {
        state.remainingQty = decimal(data.remainingQty);
        return { count: 1 };
      });
      mocks.materialBatchEntry.findUniqueOrThrow.mockImplementation(async () => state);
      mocks.materialBatchEntry.findMany.mockImplementation(async () => [state]);
      await adjustMaterialStock(item.id, purchase.id, {
        quantity: 7,
        expectedQuantity: before,
        reason: '盘点',
      });
      expect(mocks.materialStockAdjustment.create).toHaveBeenCalled();
      expect((await readAssistantStock(tx, source)).sourceStock[0]).toMatchObject({
        purchasedQuantity: '10.00',
        remainingQuantity: '7.00',
      });
      expect((await readAssistantStock(tx, current)).catalogStock[0].knownStock).toBe('7.00');
    },
  );
  it('rejects inconsistent output identity counts and units', async () => {
    const result = await readAssistantStock(tx, current);
    expect(stockResultSchema.safeParse({ ...result, catalogItemCount: 10 }).success).toBe(false);
    expect(
      stockResultSchema.safeParse({
        ...result,
        catalogStock: [{ ...result.catalogStock[0], unit: 'PIECE' }],
      }).success,
    ).toBe(false);
  });
});

describe('authenticated stock service', () => {
  it('authenticates before validation or database access', async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(queryAssistantStock(request, {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects invalid input before beginning a transaction', async () => {
    await expect(queryAssistantStock(request, { ...current, actorId: 'forged' })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('uses a read-only consistent transaction and refreshes on each account request', async () => {
    expect((await queryAssistantStock(request, current)).catalogStock[0].knownStock).toBe('6.00');
    mocks.auth.mockResolvedValue({ user: { id: 'account-b', name: 'other' } });
    mocks.materialBatchEntry.findMany.mockResolvedValue([entry(11, 1)]);
    expect((await queryAssistantStock(request, current)).catalogStock[0].knownStock).toBe('1.00');
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    expect(mocks.scope).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 20000,
    });
    expect(mocks.execute.mock.calls.map((args) => args[0].join(''))).toContain(
      'SET TRANSACTION READ ONLY',
    );
    expect(mocks.scope.mock.calls[0][1]).toEqual(query);
  });
});
