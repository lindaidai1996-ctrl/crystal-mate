import { describe, expect, it } from 'vitest';
import {
  analyzeProcurement,
  filterProcurementRows,
  procurementAnalysisSummary,
  procurementSupplierOptions,
} from '@/lib/material-pricing/analytics';
import type { ProcurementRow } from '@/lib/material-pricing/purchase-contracts';

const row = (patch: Partial<ProcurementRow> = {}): ProcurementRow => ({
  id: '1',
  batchId: 'b',
  batchName: 'batch',
  receivedAt: '2026-01-10',
  distributorId: 's1',
  distributorName: 'Supplier A',
  materialId: 'm1',
  materialName: 'Silver',
  groupId: 'g1',
  groupName: 'S925',
  weight: '1',
  amount: '10',
  quote: '20',
  quotePurpose: 'BEFORE_DISCOUNT',
  actualPrice: '999',
  discount: '999',
  remaining: null,
  ...patch,
});

describe('procurement analysis', () => {
  it('weights actual prices and quotes by raw weights, never averages rounded line prices', () => {
    const result = procurementAnalysisSummary([
      row(),
      row({ id: '2', weight: '9', amount: '180', quote: '30' }),
    ]);
    expect(result.weight).toBe('10.00');
    expect(result.amount).toBe('190.00');
    expect(result.actualPrice).toBe('19.0000');
    expect(result.quotePrice).toBe('29.0000');
    expect(result.discount).toBe('6.55');
  });
  it('keeps zero payment and zero quote while excluding unknown values from matching denominators', () => {
    const result = procurementAnalysisSummary([
      row({ weight: '2', amount: '0', quote: '0' }),
      row({ id: '2', weight: '100', amount: null, quote: null }),
      row({ id: '3', weight: null, amount: '7', quote: '999' }),
    ]);
    expect(result.weight).toBe('102.00');
    expect(result.amount).toBe('7.00');
    expect(result.actualPrice).toBe('0.0000');
    expect(result.quotePrice).toBe('0.0000');
    expect(result.priceCount).toBe(1);
    expect(result.quoteCount).toBe(1);
    expect(result.unknownWeight).toBe(1);
    expect(result.unknownAmount).toBe(1);
    expect(result.discount).toBeNull();
  });
  it('does not relabel legacy quotes as before-discount quotes', () => {
    const result = procurementAnalysisSummary([
      row({ quotePurpose: 'LEGACY' }),
      row({ id: '2', weight: '2', amount: '30', quote: '30' }),
    ]);
    expect(result.quotePrice).toBe('30.0000');
    expect(result.quoteCount).toBe(1);
    expect(result.discount).toBe('5.00');
  });
  it('preserves Decimal totals beyond float precision and rounds prices only after aggregation', () => {
    const result = procurementAnalysisSummary([
      row({ amount: '9999999999.99', weight: '3' }),
      row({ amount: '0.01', weight: '3' }),
    ]);
    expect(result.amount).toBe('10000000000.00');
    expect(result.actualPrice).toBe('1666666666.6667');
  });
  it('keeps unknown totals and latest missing prices unknown', () => {
    expect(procurementAnalysisSummary([]).amount).toBeNull();
    expect(procurementAnalysisSummary([row({ amount: null, weight: null })]).weight).toBeNull();
    const result = procurementAnalysisSummary([
      row(),
      row({ id: '2', receivedAt: '2026-02-01', amount: null, quote: null }),
    ]);
    expect(result.latestDate).toBe('2026-02-01');
    expect(result.latestActualPrice).toBeNull();
    expect(result.latestQuote).toBeNull();
  });
  it('separates suppliers by pricing group and avoids blended gram prices across groups', () => {
    const result = analyzeProcurement(
      [row(), row({ groupId: 'g2', groupName: 'Thai silver', amount: '40' })],
      'month',
    );
    expect(result.suppliers).toHaveLength(2);
    expect(result.suppliers.map((item) => item.actualPrice)).toEqual(['10.0000', '40.0000']);
    expect(result.totals.actualPrice).toBeNull();
    expect(result.totals.quotePrice).toBeNull();
    expect(result.supplierShares).toHaveLength(1);
    expect(result.groupShares).toHaveLength(2);
  });
  it('uses purchase dates and returns sorted day, month, year aggregates across year boundaries', () => {
    const rows = [
      row({ receivedAt: '2026-02-02' }),
      row({ receivedAt: '2025-12-31' }),
      row({ receivedAt: '2026-02-01' }),
    ];
    expect(analyzeProcurement(rows, 'day').periods.map((item) => item.key)).toEqual([
      '2025-12-31',
      '2026-02-01',
      '2026-02-02',
    ]);
    expect(analyzeProcurement(rows, 'month').periods.map((item) => [item.key, item.count])).toEqual(
      [
        ['2025-12', 1],
        ['2026-02', 2],
      ],
    );
    expect(analyzeProcurement(rows, 'year').periods.map((item) => item.key)).toEqual([
      '2025',
      '2026',
    ]);
  });
  it('offers only suppliers present within the group and inclusive purchase date scope', () => {
    const rows = [
      row(),
      row({ id: '2', groupId: 'g2', distributorId: 's2', distributorName: 'Other' }),
      row({ id: '3', receivedAt: '2026-02-01', distributorId: 's3', distributorName: 'Later' }),
      row({ id: '4' }),
    ];
    const scoped = filterProcurementRows(rows, {
      groupId: 'g1',
      dates: ['2026-01-10', '2026-01-31'],
    });
    expect(procurementSupplierOptions(scoped)).toEqual([{ value: 's1', label: 'Supplier A' }]);
    expect(filterProcurementRows(scoped, { distributorId: 's2' })).toEqual([]);
    expect(filterProcurementRows(rows, {})).toHaveLength(4);
  });
  it('aggregates all rows, regardless of table pagination', () => {
    const result = analyzeProcurement(
      Array.from({ length: 501 }, (_, i) => row({ id: String(i), amount: '0.01', weight: '0.01' })),
      'month',
    );
    expect(result.totals.count).toBe(501);
    expect(result.totals.amount).toBe('5.01');
    expect(result.periods[0].weight).toBe('5.01');
    expect(result.supplierShares[0].amount).toBe('5.01');
  });
});
