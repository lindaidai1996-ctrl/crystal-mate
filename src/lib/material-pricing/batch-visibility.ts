export function isPricingOnlyBatch(batch: {
  purpose?: string;
  _count?: { entries: number; productEntries: number };
  ordinaryEntryCount?: number;
}) {
  return (
    batch.purpose === 'PRICING' &&
    (batch._count?.entries ?? 0) > 0 &&
    batch._count?.productEntries === 0 &&
    batch.ordinaryEntryCount === 0
  );
}

export function selectablePurchaseBatches<
  T extends Parameters<typeof isPricingOnlyBatch>[0] & { id: string },
>(batches: T[], showPricing: boolean, selectedId?: string | null) {
  return batches.filter(
    (batch) => showPricing || batch.id === selectedId || !isPricingOnlyBatch(batch),
  );
}
