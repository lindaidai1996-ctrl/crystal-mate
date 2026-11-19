import { describe, expect, it } from 'vitest';
import { compareDistributorHistory } from '../../src/lib/distributor-list-sort';
const rows = [
  { id: 'empty', batchCount: 0, latestReceivedAt: null },
  { id: 'older', batchCount: 8, latestReceivedAt: '2026-10-01' },
  { id: 'newer', batchCount: 2, latestReceivedAt: '2026-11-18' },
];
describe('distributor cooperation sorting on desktop and mobile', () => {
  it('keeps missing dates last in either direction', () => {
    expect(
      [...rows]
        .sort((a, b) =>
          compareDistributorHistory(a, b, { key: 'latestReceivedAt', order: 'ascend' }),
        )
        .map((r) => r.id),
    ).toEqual(['older', 'newer', 'empty']);
    expect(
      [...rows]
        .sort((a, b) =>
          compareDistributorHistory(a, b, { key: 'latestReceivedAt', order: 'descend' }),
        )
        .map((r) => r.id),
    ).toEqual(['newer', 'older', 'empty']);
  });
  it('sorts batch counts and uses identity to break ties', () => {
    expect(
      [...rows]
        .sort((a, b) => compareDistributorHistory(a, b, { key: 'batchCount', order: 'descend' }))
        .map((r) => r.id),
    ).toEqual(['older', 'newer', 'empty']);
    expect(
      compareDistributorHistory(
        rows[0],
        { ...rows[0], id: 'z' },
        { key: 'batchCount', order: 'ascend' },
      ),
    ).toBeLessThan(0);
  });
});
