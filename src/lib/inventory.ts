export const MAX_STOCK = 2147483647;

export function materialStockSummary(entries: { remainingQty: number | null }[]) {
  return entries.reduce(
    (summary, entry) => {
      if (entry.remainingQty === null) summary.unknownStockBatchCount += 1;
      else summary.knownStock = Math.round((summary.knownStock + entry.remainingQty) * 100) / 100;
      return summary;
    },
    { knownStock: 0, unknownStockBatchCount: 0 },
  );
}

export function correctedRemainingQuantity(
  current: { receivedQty: number | null; remainingQty: number | null },
  receivedQty: number | null,
) {
  if (current.remainingQty === null) return receivedQty;
  if (current.receivedQty === null || receivedQty === null) return current.remainingQty;
  return Math.round((current.remainingQty + receivedQty - current.receivedQty) * 100) / 100;
}

export function validMaterialQuantity(value: number, unit: string) {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_STOCK &&
    (unit === 'GRAM' ? /^\d+(?:\.\d{1,2})?$/.test(String(value)) : Number.isInteger(value))
  );
}
