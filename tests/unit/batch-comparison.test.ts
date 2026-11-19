import { describe, expect, it } from 'vitest';
import {
  buildBatchComparison,
  comparisonQuerySchema,
  comparisonTotal,
} from '@/lib/batch-comparison';
import type { ComparisonEntry } from '@/lib/batch-comparison-contracts';

const item = { id: 'm', name: 'Crystal', kind: 'material', unit: 'STRAND' } as const;
function entry(id: string, changes: Partial<ComparisonEntry> = {}): ComparisonEntry {
  return {
    id,
    batch: { id, name: id, receivedAt: '2026-11-01' },
    distributor: { id: 'a', name: 'A' },
    quantity: '10',
    amount: '100',
    quantities: { STRAND: '10', BEAD: '200', GRAM: '50' },
    prices: { STRAND: '10', BEAD: '0.5', GRAM: '2' },
    priceSource: 'UNIT',
    remainingQuantity: '2',
    remainingPercent: '20',
    inventoryValue: '20',
    dimensions: null,
    notes: '',
    href: '/admin/materials/m',
    ...changes,
  };
}
describe('purchase batch comparison arithmetic', () => {
  it('groups duplicate purchase rows, keeps same-date batches separate and weights by quantity', () => {
    const result = buildBatchComparison(item, [
      entry('a'),
      entry('b', { quantity: '30', amount: '600', quantities: { STRAND: '30' } }),
      entry('c', {
        batch: { id: 'a', name: 'a', receivedAt: '2026-11-01' },
        quantity: '10',
        amount: '300',
        quantities: { STRAND: '10' },
        distributor: { id: 'b', name: 'B' },
      }),
    ]);
    expect(result.totalBatchCount).toBe(2);
    expect(result.batches.map((batch) => batch.id)).toEqual(['a', 'b']);
    expect(result.batches[0]).toMatchObject({
      quantity: '20.00',
      amount: '400.00',
      prices: { STRAND: '20.000000' },
    });
    expect(result.batches[0].entries).toHaveLength(2);
    expect(result.summary.prices.STRAND).toMatchObject({
      weightedMean: '20.000000',
      eligibleBatchCount: 2,
      changePercent: '0.00',
    });
    expect(result.summary.averageIntervalDays).toBe('0.00');
  });

  it('applies inclusive dates and distributor scope consistently without changing all-history options', () => {
    const rows = [
      entry('a'),
      entry('b', { batch: { id: 'b', name: 'b', receivedAt: '2026-11-08' } }),
      entry('c', {
        batch: { id: 'c', name: 'c', receivedAt: '2026-11-08' },
        distributor: { id: 'b', name: 'B' },
      }),
    ];
    const result = buildBatchComparison(item, rows, {
      receivedFrom: '2026-11-08',
      receivedTo: '2026-11-08',
      distributorId: 'a',
    });
    expect(result.batches.map((batch) => batch.id)).toEqual(['b']);
    expect(result.summary).toMatchObject({
      batchCount: 1,
      quantity: { known: '10.00', missingCount: 0 },
      amount: { known: '100.00', missingCount: 0 },
    });
    expect(result.totalBatchCount).toBe(3);
    expect(result.distributors).toHaveLength(2);
    expect(result.summary.averageIntervalDays).toBeNull();
    expect(result.summary.prices.STRAND?.changePercent).toBeNull();
  });

  it('uses corresponding gram and bead denominators rather than averaging unit prices', () => {
    const result = buildBatchComparison(item, [
      entry('a'),
      entry('b', {
        amount: '300',
        quantity: '30',
        quantities: { STRAND: '30', BEAD: '300', GRAM: '30' },
      }),
    ]);
    expect(result.summary.prices).toMatchObject({
      STRAND: { weightedMean: '10.000000' },
      BEAD: { weightedMean: '0.800000' },
      GRAM: { weightedMean: '5.000000' },
    });
  });

  it('excludes unknown pairs from weighted means and retains missing values rather than zero', () => {
    const result = buildBatchComparison(item, [
      entry('a'),
      entry('b', {
        amount: null,
        quantity: null,
        quantities: { STRAND: null, GRAM: null },
        prices: { STRAND: null },
        remainingQuantity: null,
        inventoryValue: null,
      }),
    ]);
    expect(result.batches[1]).toMatchObject({
      quantity: null,
      amount: null,
      prices: { STRAND: null },
    });
    expect(result.summary.amount).toEqual({ known: '100.00', missingCount: 1 });
    expect(result.summary.currentStock).toEqual({ known: '2.00', missingCount: 1 });
    expect(result.summary.inventoryValue).toEqual({ known: '20.00', missingCount: 1 });
    expect(result.summary.prices.STRAND).toMatchObject({
      weightedMean: '10.000000',
      eligibleBatchCount: 1,
      changePercent: null,
    });
  });

  it('retains manually entered prices without inventing a weighted mean for unknown quantities', () => {
    const result = buildBatchComparison(item, [
      entry('a', {
        amount: null,
        quantity: null,
        quantities: { STRAND: null },
        prices: { STRAND: '12.34' },
        priceSource: 'MANUAL',
      }),
    ]);
    expect(result.batches[0].prices.STRAND).toBe('12.34');
    expect(result.summary.prices.STRAND).toMatchObject({
      weightedMean: null,
      eligibleBatchCount: 0,
    });
  });

  it('does not calculate percentage change from a zero price or skip a missing latest batch', () => {
    const result = buildBatchComparison(item, [entry('a', { amount: '0' }), entry('b')]);
    expect(result.summary.prices.STRAND?.changePercent).toBeNull();
    expect(
      buildBatchComparison(item, [
        entry('a'),
        entry('b', { amount: null, prices: { STRAND: null } }),
      ]).summary.prices.STRAND?.changePercent,
    ).toBeNull();
  });

  it('computes gaps using dates and oldest positive current stock using the Beijing day', () => {
    const result = buildBatchComparison(
      item,
      [
        entry('a', { remainingQuantity: '0' }),
        entry('b', { batch: { id: 'b', name: 'b', receivedAt: '2026-11-08' } }),
      ],
      {},
      null,
      new Date('2026-11-17T17:00:00Z'),
    );
    expect(result.summary.averageIntervalDays).toBe('7.00');
    expect(result.summary.oldestRemainingBatch).toEqual({ id: 'b', name: 'b', days: 10 });
  });

  it('uses exact decimals for large sums and small amounts', () => {
    expect(comparisonTotal(['99999999999999999999.99', '0.01'])).toEqual({
      known: '100000000000000000000.00',
      missingCount: 0,
    });
    const result = buildBatchComparison(item, [
      entry('a', { amount: '0.01', quantities: { STRAND: '3' } }),
    ]);
    expect(result.summary.prices.STRAND?.weightedMean).toBe('0.003333');
  });

  it('keeps whole-product current stock separate from filtered purchase quantities', () => {
    const result = buildBatchComparison(
      { ...item, kind: 'product', unit: 'PIECE' },
      [entry('a')],
      { distributorId: 'none' },
      '17',
    );
    expect(result.batches).toEqual([]);
    expect(result.summary.quantity.known).toBe('0.00');
    expect(result.summary.currentStock.known).toBe('17.00');
    expect(result.summary.inventoryValue).toBeNull();
  });

  it('rejects invalid dates, reversed ranges and empty distributors', () => {
    for (const query of [
      { receivedFrom: '2026-02-30' },
      { receivedFrom: '2026-11-09', receivedTo: '2026-11-01' },
      { distributorId: '' },
    ])
      expect(comparisonQuerySchema.safeParse(query).success).toBe(false);
  });
});
