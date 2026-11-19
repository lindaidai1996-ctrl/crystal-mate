export type DistributorHistorySort = {
  key: 'batchCount' | 'latestReceivedAt';
  order: 'ascend' | 'descend';
};

export function compareDistributorHistory(
  a: { id: string; batchCount: number; latestReceivedAt: string | null },
  b: { id: string; batchCount: number; latestReceivedAt: string | null },
  sort: DistributorHistorySort,
) {
  const direction = sort.order === 'ascend' ? 1 : -1;
  if (sort.key === 'latestReceivedAt') {
    if (!a.latestReceivedAt && b.latestReceivedAt) return 1;
    if (a.latestReceivedAt && !b.latestReceivedAt) return -1;
    return (
      direction * (a.latestReceivedAt ?? '').localeCompare(b.latestReceivedAt ?? '') ||
      a.id.localeCompare(b.id)
    );
  }
  return direction * (a.batchCount - b.batchCount) || a.id.localeCompare(b.id);
}
