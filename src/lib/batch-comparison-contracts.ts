export type ComparisonKind = 'material' | 'product';
export type ComparisonUnit = 'STRAND' | 'BEAD' | 'GRAM' | 'PIECE';
export type ComparisonPrices = Partial<Record<ComparisonUnit, string | null>>;

export type ComparisonEntry = {
  id: string;
  batch: { id: string; name: string; receivedAt: string };
  distributor: { id: string; name: string };
  quantity: string | null;
  amount: string | null;
  quantities: ComparisonPrices;
  prices: ComparisonPrices;
  priceSource: string;
  remainingQuantity: string | null;
  remainingPercent: string | null;
  inventoryValue: string | null;
  dimensions: {
    lengthMm: string | null;
    widthMm: string | null;
    heightMm: string | null;
    childCount: number | null;
    weightGrams: string | null;
  } | null;
  notes: string;
  href: string;
};

export type ComparisonBatch = {
  id: string;
  name: string;
  receivedAt: string;
  quantity: string | null;
  amount: string | null;
  prices: ComparisonPrices;
  entries: ComparisonEntry[];
};

export type ComparisonTotal = { known: string; missingCount: number };
export type BatchComparison = {
  item: { id: string; name: string; kind: ComparisonKind; unit: ComparisonUnit };
  currency: 'CNY';
  queriedAt: string;
  totalBatchCount: number;
  distributors: { id: string; name: string }[];
  batches: ComparisonBatch[];
  summary: {
    batchCount: number;
    quantity: ComparisonTotal;
    amount: ComparisonTotal;
    prices: Partial<
      Record<
        ComparisonUnit,
        {
          weightedMean: string | null;
          eligibleBatchCount: number;
          changePercent: string | null;
        }
      >
    >;
    averageIntervalDays: string | null;
    currentStock: ComparisonTotal;
    inventoryValue: ComparisonTotal | null;
    oldestRemainingBatch: { id: string; name: string; days: number } | null;
  };
};
