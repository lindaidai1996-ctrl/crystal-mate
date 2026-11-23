import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import { assistantQuerySchema } from '../../src/lib/ai-assistant/contracts';
import {
  CANDIDATE_RUN_TTL_MS,
  type CandidateDetail,
} from '../../src/lib/ai-assistant/candidate-contracts';
import {
  purchaseEntrySchema,
  purchaseQuerySchema,
  type PurchaseEntry,
} from '../../src/lib/ai-assistant/purchase-contracts';
import { summarizeAssistantPurchases } from '../../src/lib/ai-assistant/purchase-summary';
import { PurchaseRuns } from '../../src/lib/ai-assistant/purchase-runs';

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  scope: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  materialBatchEntry: { findMany: vi.fn() },
  productPurchaseEntry: { findMany: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ requireAccount: mocks.requireAccount }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('../../src/lib/ai-assistant/candidate-data', () => ({
  readAssistantCandidates: mocks.scope,
}));
import { readAssistantPurchases } from '../../src/lib/ai-assistant/purchase-data';
import { queryAssistantPurchases } from '../../src/lib/ai-assistant/purchase-service';

const id = (n: number) => `c${n.toString().padStart(24, '0')}`;
const request = new NextRequest('http://localhost/api/assistant');
const query = assistantQuerySchema.parse({
  version: 'v1',
  subject: 'purchases',
  itemTypes: ['MATERIAL'],
  hard: {
    purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
    distributorIds: baseline.scope.distributorIds,
  },
  semantic: [],
  ruleVersion: 'v1',
  pagination: { limit: 3 },
});
const allRows: PurchaseEntry[] = baseline.scopedCandidates.map((r) =>
  purchaseEntrySchema.parse({
    item: { type: 'MATERIAL', id: r.materialId },
    purchase: { type: 'MATERIAL_PURCHASE', id: r.id },
    name: r.name,
    code: null,
    batch: { id: id(900), name: '构造批次名，冻结快照未提供原名', receivedAt: r.date },
    distributor: { id: r.distributorId, name: '构造名称，冻结快照未提供原名' },
    quantity: r.quantity,
    unit: r.unit,
    unitPrice: null,
    amount: r.amount,
    amountBasis: 'recorded_total',
    currency: 'CNY',
    currencyBasis: 'business_default',
  }),
);
const golden = allRows.filter((r) => baseline.goldenCase.includedEntryIds.includes(r.purchase.id));
const details = (rows: PurchaseEntry[]): CandidateDetail[] =>
  rows.map((r) => ({
    candidate: {
      item: r.item,
      purchase: r.purchase,
      evidence: [
        { entity: r.item, field: 'name', value: r.name },
        { entity: { type: 'BATCH', id: r.batch.id }, field: 'name', value: r.batch.name },
        {
          entity: { type: 'BATCH', id: r.batch.id },
          field: 'receivedAt',
          value: r.batch.receivedAt,
        },
        {
          entity: { type: 'DISTRIBUTOR', id: r.distributor.id },
          field: 'name',
          value: r.distributor.name,
        },
      ],
    },
    code: r.code,
    batch: { type: 'BATCH', id: r.batch.id },
    distributor: { type: 'DISTRIBUTOR', id: r.distributor.id },
  }));
const selection = golden.map((r) => r.purchase);
const input = { query, selectedPurchases: selection };
const source = () => ({ candidates: details(golden), rows: golden, scopeCandidateCount: 44 });
const tx = { ...mocks, $executeRaw: mocks.execute } as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccount.mockResolvedValue({ id: 'account', username: 'tester', nickname: '' });
  mocks.scope.mockResolvedValue(details(allRows));
  mocks.materialBatchEntry.findMany.mockResolvedValue(
    allRows.map((r) => ({
      id: r.purchase.id,
      materialId: r.item.id,
      batchId: r.batch.id,
      distributorId: r.distributor.id,
      material: { unit: r.unit },
      receivedQty: new Prisma.Decimal(r.quantity!),
      purchaseTotalAmount: new Prisma.Decimal(r.amount!),
      purchaseUnitPrice: null,
    })),
  );
  mocks.productPurchaseEntry.findMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
});

describe('Decimal purchase summaries', () => {
  it('reads re-entered quantities, gram prices and amounts after unit correction', async () => {
    const row = golden[0];
    mocks.scope.mockResolvedValue(details([row]));
    mocks.materialBatchEntry.findMany.mockResolvedValue([
      {
        id: row.purchase.id,
        materialId: row.item.id,
        batchId: row.batch.id,
        distributorId: row.distributor.id,
        material: { unit: 'GRAM' },
        receivedQty: new Prisma.Decimal('12.50'),
        purchaseUnitPrice: new Prisma.Decimal('6.50'),
        purchaseTotalAmount: new Prisma.Decimal('81.25'),
      },
    ]);
    const result = await readAssistantPurchases(tx, { query });
    expect(result.rows[0]).toMatchObject({
      unit: 'GRAM',
      quantity: '12.50',
      unitPrice: '6.50',
      amount: '81.25',
      amountBasis: 'recorded_total',
    });
  });
  it('uses a corrected unit on fresh purchase reads while preserving quantities and amounts', async () => {
    const row = golden[0];
    mocks.scope.mockResolvedValue(details([row]));
    const source = {
      id: row.purchase.id,
      materialId: row.item.id,
      batchId: row.batch.id,
      distributorId: row.distributor.id,
      material: { unit: 'STRAND' },
      receivedQty: new Prisma.Decimal(100),
      purchaseUnitPrice: new Prisma.Decimal(2),
      purchaseTotalAmount: new Prisma.Decimal(200),
    };
    mocks.materialBatchEntry.findMany.mockResolvedValue([source]);
    const before = await readAssistantPurchases(tx, { query });
    mocks.materialBatchEntry.findMany.mockResolvedValue([
      { ...source, material: { unit: 'BEAD' } },
    ]);
    const after = await readAssistantPurchases(tx, { query });
    expect(before.rows[0]).toMatchObject({ unit: 'STRAND', quantity: '100.00', amount: '200.00' });
    expect(after.rows[0]).toMatchObject({
      unit: 'BEAD',
      quantity: '100.00',
      amount: '200.00',
      unitPrice: '2.00',
    });
  });
  it('recomputes frozen 11 rows, 1897.60, unit quantities and both distributor groups', () => {
    const summary = summarizeAssistantPurchases(golden, 44, 'selected_purchases');
    expect(summary.totals).toMatchObject({
      purchaseEntryCount: 11,
      catalogItemCount: 11,
      amounts: [
        {
          currency: 'CNY',
          knownAmount: '1897.60',
          unknownAmountEntryCount: 0,
          businessDefaultCurrencyEntryCount: 11,
        },
      ],
    });
    expect(
      Object.fromEntries(summary.totals.quantities.map((r) => [r.unit, r.knownQuantity])),
    ).toEqual(baseline.goldenCase.quantitiesByUnit);
    for (const group of summary.byDistributor)
      expect(group.totals.amounts[0].knownAmount).toBe(
        baseline.goldenCase.distributorGroups[
          group.distributor.id as keyof typeof baseline.goldenCase.distributorGroups
        ].amount,
      );
  });
  it('keeps multiple purchases of one catalog identity and exact decimals', () => {
    const rows = [0, 1, 2].map((n) => ({
      ...golden[0],
      purchase: { ...golden[0].purchase, id: id(n) },
      quantity: '0.10',
      amount: '0.10',
    }));
    const summary = summarizeAssistantPurchases(rows, 3, 'hard_scope');
    expect(summary.totals).toMatchObject({
      purchaseEntryCount: 3,
      catalogItemCount: 1,
      amounts: [{ knownAmount: '0.30' }],
    });
    expect(summary.byCatalog[0].totals.purchaseEntryCount).toBe(3);
  });
  it('never sums currencies together and counts unknown amounts and quantities', () => {
    const rows: PurchaseEntry[] = [
      {
        ...golden[0],
        purchase: { type: 'MATERIAL_PURCHASE', id: id(1) },
        quantity: null,
        amount: null,
        amountBasis: 'unknown',
      },
      {
        ...golden[0],
        purchase: { type: 'MATERIAL_PURCHASE', id: id(2) },
        amount: '20.00',
        currency: 'USD',
        currencyBasis: 'recorded',
      },
      {
        ...golden[0],
        purchase: { type: 'MATERIAL_PURCHASE', id: id(3) },
        amount: '30.00',
        currency: null,
        currencyBasis: 'unknown',
      },
    ];
    const summary = summarizeAssistantPurchases(rows, 3, 'hard_scope');
    expect(summary.totals.amounts).toEqual([
      {
        currency: null,
        knownAmount: '30.00',
        unknownAmountEntryCount: 0,
        businessDefaultCurrencyEntryCount: 0,
      },
      {
        currency: 'CNY',
        knownAmount: '0.00',
        unknownAmountEntryCount: 1,
        businessDefaultCurrencyEntryCount: 1,
      },
      {
        currency: 'USD',
        knownAmount: '20.00',
        unknownAmountEntryCount: 0,
        businessDefaultCurrencyEntryCount: 0,
      },
    ]);
    expect(summary.totals.quantities[0].unknownQuantityEntryCount).toBe(1);
  });
  it('retains sub-cent amounts without rounding individual rows', () => {
    const rows = [1, 2, 3].map((n) => ({
      ...golden[0],
      purchase: { ...golden[0].purchase, id: id(n) },
      amount: '0.0025',
    }));
    expect(summarizeAssistantPurchases(rows, 3, 'hard_scope').totals.amounts[0].knownAmount).toBe(
      '0.0075',
    );
  });
  it('sums large values beyond Number safe integer and default Decimal precision', () => {
    const rows = [1, 2].map((n) => ({
      ...golden[0],
      purchase: { ...golden[0].purchase, id: id(n) },
      amount: '9999999999999999999.99',
    }));
    expect(summarizeAssistantPurchases(rows, 2, 'hard_scope').totals.amounts[0].knownAmount).toBe(
      '19999999999999999999.98',
    );
  });
  it('rejects duplicate rows instead of double-counting and handles true empty sets', () => {
    expect(() => summarizeAssistantPurchases([golden[0], golden[0]], 2, 'hard_scope')).toThrow(
      'DUPLICATE_PURCHASE',
    );
    expect(summarizeAssistantPurchases([], 44, 'selected_purchases').totals).toEqual({
      purchaseEntryCount: 0,
      catalogItemCount: 0,
      amounts: [],
      quantities: [],
    });
  });
});

describe('purchase contracts and snapshot pagination', () => {
  it.each([1, 3, 11, 100])(
    'pages all selected rows at limit %i with the same full summary',
    async (limit) => {
      const runs = new PurchaseRuns();
      const load = vi.fn(async () => source());
      let page = await runs.query(
        'a',
        { ...input, query: { ...query, pagination: { limit } } },
        load,
      );
      const firstSummary = page.summary;
      const ids: string[] = [];
      for (;;) {
        ids.push(...page.items.map((r) => r.purchase.id));
        expect(page.summary).toEqual(firstSummary);
        expect(page.summary.totals.amounts[0].knownAmount).toBe('1897.60');
        if (!page.nextCursor) break;
        page = await runs.query(
          'a',
          { ...input, query: { ...query, pagination: { limit, cursor: page.nextCursor } } },
          load,
        );
      }
      expect(ids).toEqual(selection.map((r) => r.id).sort());
      expect(new Set(ids).size).toBe(11);
      expect(page.completeness).toMatchObject({
        totalCandidates: 11,
        readCandidates: 11,
        traversal: 'complete',
        evaluation: 'not_started',
      });
      expect(load).toHaveBeenCalledTimes(1);
    },
  );
  it('binds exact selection to cursors, accepts reordering and denies other accounts/expired runs', async () => {
    let now = 0;
    const runs = new PurchaseRuns(() => now);
    const load = async () => source();
    const first = await runs.query('a', input, load);
    const next = {
      ...input,
      query: { ...query, pagination: { limit: 3, cursor: first.nextCursor } },
    };
    await expect(
      runs.query('a', { ...next, selectedPurchases: selection.slice(1) }, load),
    ).rejects.toThrow('CURSOR_SCOPE_MISMATCH');
    await expect(runs.query('a', { query: next.query }, load)).rejects.toThrow(
      'CURSOR_SCOPE_MISMATCH',
    );
    const page = await runs.query('a', next, load);
    expect(
      (await runs.query('a', { ...next, selectedPurchases: [...selection].reverse() }, load)).items,
    ).toEqual(page.items);
    await expect(runs.query('b', next, load)).rejects.toThrow('RUN_RESTART_REQUIRED');
    now = CANDIDATE_RUN_TTL_MS;
    await expect(runs.query('a', next, load)).rejects.toThrow('RUN_RESTART_REQUIRED');
  });
  it('freezes financial facts and summaries against source/caller mutation', async () => {
    const runs = new PurchaseRuns();
    const current = structuredClone(source());
    const first = await runs.query('a', input, async () => current);
    current.rows[4].amount = '0.00';
    first.summary.totals.amounts[0].knownAmount = '0.00';
    const second = await runs.query(
      'a',
      { ...input, query: { ...query, pagination: { limit: 3, cursor: first.nextCursor } } },
      async () => {
        throw new Error('RELOAD');
      },
    );
    expect(second.summary.totals.amounts[0].knownAmount).toBe('1897.60');
    expect(second.items.some((r) => r.amount !== '0.00')).toBe(true);
  });
  it.each([
    { query: { ...query, subject: 'catalog', hard: {} } },
    { ...input, selectedPurchases: [selection[0], selection[0]] },
    { ...input, selectedPurchases: [{ type: 'PRODUCT_PURCHASE', id: id(1) }] },
    { ...input, sql: 'SELECT *' },
    { ...input, query: { ...query, ownerId: id(1) } },
  ])('rejects invalid purchase input %#', (value) => {
    expect(purchaseQuerySchema.safeParse(value).success).toBe(false);
  });
  it.each(['NaN', 'Infinity', '-1.00', '1e10', '01.00', '1.00001'])(
    'rejects noncanonical amount %s',
    (amount) => {
      expect(purchaseEntrySchema.safeParse({ ...golden[0], amount }).success).toBe(false);
    },
  );
});

describe('purchase data access and authentication', () => {
  it('denies unauthenticated and malformed input before database access', async () => {
    mocks.requireAccount.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    await expect(queryAssistantPurchases(request, input)).rejects.toThrow('UNAUTHORIZED');
    await expect(queryAssistantPurchases(request, { ...input, sql: 'SELECT 1' })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('selects only exact authorized purchase rows and preserves unknown quantity with a recorded total', async () => {
    const row = allRows[0];
    mocks.scope.mockResolvedValue(details([row]));
    mocks.materialBatchEntry.findMany.mockResolvedValue([
      {
        id: row.purchase.id,
        materialId: row.item.id,
        batchId: row.batch.id,
        distributorId: row.distributor.id,
        receivedQty: null,
        purchaseUnitPrice: new Prisma.Decimal(10),
        purchaseTotalAmount: new Prisma.Decimal(90),
        material: { unit: 'STRAND' },
      },
    ]);
    const page = await queryAssistantPurchases(request, {
      query,
      selectedPurchases: [row.purchase],
    });
    expect(page.items[0]).toMatchObject({
      quantity: null,
      amount: '90.00',
      amountBasis: 'recorded_total',
      currency: 'CNY',
      currencyBasis: 'business_default',
    });
    expect(mocks.materialBatchEntry.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [row.purchase.id] },
    });
    expect(page.summary.totals.quantities[0]).toMatchObject({
      knownQuantity: '0.00',
      unknownQuantityEntryCount: 1,
    });
  });
  it.each([
    ['10.00', '10.00', '90.00', '90.00', 'recorded_total'],
    ['0.25', '0.01', null, '0.0025', 'quantity_times_unit_price'],
    ['0.00', '0.00', null, '0.00', 'quantity_times_unit_price'],
    [null, '10.00', null, null, 'unknown'],
    ['10.00', null, null, null, 'unknown'],
  ])(
    'handles quantity=%s unitPrice=%s recorded=%s',
    async (quantity, price, total, expected, basis) => {
      const row = allRows[0];
      mocks.scope.mockResolvedValue(details([row]));
      mocks.materialBatchEntry.findMany.mockResolvedValue([
        {
          id: row.purchase.id,
          materialId: row.item.id,
          batchId: row.batch.id,
          distributorId: row.distributor.id,
          material: { unit: 'GRAM' },
          receivedQty: quantity === null ? null : new Prisma.Decimal(quantity),
          purchaseUnitPrice: price === null ? null : new Prisma.Decimal(price),
          purchaseTotalAmount: total === null ? null : new Prisma.Decimal(total),
        },
      ]);
      const result = await readAssistantPurchases(tx, purchaseQuerySchema.parse({ query }));
      expect(result.rows[0]).toMatchObject({ amount: expected, amountBasis: basis });
    },
  );
  it('uses product purchase cost, never sale price or sale currency', async () => {
    const row: PurchaseEntry = {
      ...golden[0],
      item: { type: 'PRODUCT', id: id(1) },
      purchase: { type: 'PRODUCT_PURCHASE', id: id(2) },
      unit: 'PIECE',
      code: 'P001',
    };
    mocks.scope.mockResolvedValue(details([row]));
    mocks.productPurchaseEntry.findMany.mockResolvedValue([
      {
        id: id(2),
        productId: id(1),
        batchId: row.batch.id,
        distributorId: row.distributor.id,
        quantity: 3,
        unitCost: new Prisma.Decimal('80.12'),
        priceCents: 999999,
        currency: 'USD',
      },
    ]);
    const result = await readAssistantPurchases(
      tx,
      purchaseQuerySchema.parse({ query: { ...query, itemTypes: ['PRODUCT'] } }),
    );
    expect(result.rows[0]).toMatchObject({
      quantity: '3.00',
      unitPrice: '80.12',
      amount: '240.36',
      unit: 'PIECE',
      currency: 'CNY',
      currencyBasis: 'business_default',
    });
    expect(mocks.productPurchaseEntry.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'priceCents',
    );
    expect(mocks.productPurchaseEntry.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'currency',
    );
  });
  it('rejects selected IDs outside the validated hard scope before reading money', async () => {
    await expect(
      readAssistantPurchases(
        tx,
        purchaseQuerySchema.parse({
          query,
          selectedPurchases: [{ type: 'MATERIAL_PURCHASE', id: id(999) }],
        }),
      ),
    ).rejects.toThrow('PURCHASE_OUTSIDE_SCOPE');
    expect(mocks.materialBatchEntry.findMany).not.toHaveBeenCalled();
  });
  it('keeps explicit empty selection empty while retaining scope candidate count', async () => {
    const result = await queryAssistantPurchases(request, { query, selectedPurchases: [] });
    expect(result).toMatchObject({
      items: [],
      nextCursor: null,
      summary: {
        basis: 'selected_purchases',
        scopeCandidateCount: 44,
        totals: { purchaseEntryCount: 0 },
      },
      completeness: { totalCandidates: 0, traversal: 'complete' },
    });
    expect(mocks.materialBatchEntry.findMany).not.toHaveBeenCalled();
  });
  it('reads all hard-scope purchases when selection is omitted', async () => {
    const result = await queryAssistantPurchases(request, { query });
    expect(result.summary).toMatchObject({
      basis: 'hard_scope',
      scopeCandidateCount: 44,
      totals: { purchaseEntryCount: 44 },
    });
    expect(result.items).toHaveLength(3);
  });
  it('uses one read-only consistent transaction, reauthenticates pages and propagates failure', async () => {
    const first = await queryAssistantPurchases(request, { query });
    await queryAssistantPurchases(request, {
      query: { ...query, pagination: { limit: 3, cursor: first.nextCursor } },
    });
    expect(mocks.requireAccount).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 20000,
    });
    expect(mocks.execute.mock.calls[0][0][0]).toBe('SET TRANSACTION READ ONLY');
    mocks.transaction.mockRejectedValueOnce(new Error('DB_FAILED'));
    await expect(queryAssistantPurchases(request, { query })).rejects.toThrow('DB_FAILED');
  });
  it('rejects missing or changed purchase relationships rather than returning partial money', async () => {
    mocks.materialBatchEntry.findMany.mockResolvedValue([]);
    await expect(readAssistantPurchases(tx, purchaseQuerySchema.parse({ query }))).rejects.toThrow(
      'PURCHASE_SNAPSHOT_CHANGED',
    );
  });
});
