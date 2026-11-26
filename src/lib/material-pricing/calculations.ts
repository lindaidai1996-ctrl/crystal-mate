import { Prisma } from '@prisma/client';
import { shanghaiDate, type MetalPoint, type MetalQuote } from '@/lib/metal-market';
import type {
  PricingGroupInput,
  PricingPurchase,
  PricingSummary,
  PricingTotals,
} from './contracts';

const D = Prisma.Decimal.clone({ precision: 48, rounding: Prisma.Decimal.ROUND_HALF_UP });
const maximum = new D('9999999999.99');
export function priceString(value: Prisma.Decimal | null, ceil = false): string | null {
  if (value === null || !value.isFinite() || value.isNegative() || value.gt(maximum)) return null;
  return value.toFixed(2, ceil ? D.ROUND_CEIL : D.ROUND_HALF_UP);
}
export function recentStart(now = new Date()) {
  const date = new Date(`${shanghaiDate(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 89);
  return date.toISOString().slice(0, 10);
}
function aggregate(rows: PricingPurchase[], rate: string): PricingTotals {
  const amount = rows.reduce((sum, row) => sum.plus(row.amount!), new D(0));
  const weight = rows.reduce((sum, row) => sum.plus(row.weight!), new D(0));
  const raw = weight.gt(0) ? amount.div(weight) : null;
  return {
    amount: amount.toFixed(2),
    weight: weight.toFixed(2),
    count: rows.length,
    rawCost: priceString(raw),
    adjustedCost: priceString(raw?.div(new D(1).minus(new D(rate).div(100))) ?? null),
  };
}
export function summarizePurchases(
  rows: PricingPurchase[],
  rate: string,
  now = new Date(),
): PricingSummary {
  const today = shanghaiDate(now);
  const sorted = [...rows].sort(
    (a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id),
  );
  const excluded: PricingSummary['excluded'] = [];
  const valid = sorted.filter((row) => {
    const reason =
      row.receivedAt > today
        ? ('FUTURE_DATE' as const)
        : row.amount === null || !new D(row.amount).isFinite() || new D(row.amount).lt(0)
          ? ('MISSING_AMOUNT' as const)
          : row.weight === null || !new D(row.weight).isFinite() || new D(row.weight).lte(0)
            ? ('INVALID_WEIGHT' as const)
            : null;
    if (reason) excluded.push({ ...row, reason });
    return !reason;
  });
  const byDistributor = new Map<string, PricingPurchase[]>();
  for (const row of valid) {
    const bucket = byDistributor.get(row.distributorId) ?? [];
    bucket.push(row);
    byDistributor.set(row.distributorId, bucket);
  }
  return {
    totals: aggregate(valid, rate),
    recent: aggregate(
      valid.filter((row) => row.receivedAt >= recentStart(now)),
      rate,
    ),
    latest: valid[0] ?? null,
    excluded,
    purchases: sorted,
    distributors: [...byDistributor].map(([id, items]) => ({
      id,
      name: items[0].distributorName,
      ...aggregate(items, rate),
    })),
  };
}
export function computePricing(
  input: PricingGroupInput,
  summary: PricingSummary,
  market: { quote: MetalQuote; points: MetalPoint[] } | null,
  now = new Date(),
) {
  const excludedIds = new Set(summary.excluded.map((row) => row.id));
  const valid = summary.purchases.filter((row) => !excludedIds.has(row.id));
  const amount = valid.reduce((sum, row) => sum.plus(row.amount!), new D(0));
  const weight = valid.reduce((sum, row) => sum.plus(row.weight!), new D(0));
  const yieldRatio = new D(1).minus(new D(input.lossRate).div(100));
  const historical = weight.gt(0) ? amount.div(weight).div(yieldRatio) : null;
  let warning: 'MARKET_UNAVAILABLE' | 'NO_RECENT_SAMPLES' | 'INVALID_REPLACEMENT' | null = null;
  let marketBasis: { price: string; updatedAt: string; purchaseAverage: string } | null = null;
  let replacement: Prisma.Decimal | null = null;
  if (input.marketLinked) {
    const recent = valid.filter((row) => row.receivedAt >= recentStart(now));
    if (!recent.length) warning = 'NO_RECENT_SAMPLES';
    else if (!market) warning = 'MARKET_UNAVAILABLE';
    else {
      const points = [...market.points].sort((a, b) => a.date.localeCompare(b.date));
      const matched = recent.map((row) => ({
        row,
        point: points.findLast((point) => point.date <= row.receivedAt),
      }));
      if (matched.some(({ point }) => !point)) warning = 'MARKET_UNAVAILABLE';
      else {
        const recentWeight = recent.reduce((sum, row) => sum.plus(row.weight!), new D(0));
        const purchasePrice = recent
          .reduce((sum, row) => sum.plus(row.amount!), new D(0))
          .div(recentWeight);
        const average = matched
          .reduce((sum, { row, point }) => sum.plus(new D(row.weight!).mul(point!.price)), new D(0))
          .div(recentWeight);
        replacement = purchasePrice.plus(
          new D(input.marketCoefficient).mul(new D(market.quote.price).minus(average)),
        );
        marketBasis = {
          price: String(market.quote.price),
          updatedAt: market.quote.updatedAt,
          purchaseAverage: average.toFixed(8),
        };
        if (priceString(replacement) === null) {
          replacement = null;
          warning = 'INVALID_REPLACEMENT';
        }
      }
    }
  }
  const adjusted = replacement?.div(yieldRatio) ?? null;
  // Selling prices use all valid historical purchases; replacement estimates are advisory only.
  const basis = historical;
  let suggestion: Prisma.Decimal | null = null;
  if (basis !== null && input.pricingValue !== null) {
    const value = new D(input.pricingValue);
    suggestion =
      input.pricingRule === 'CUSTOM'
        ? value
        : input.pricingRule === 'PERCENT'
          ? basis.mul(new D(1).plus(value.div(100)))
          : input.pricingRule === 'FIXED'
            ? basis.plus(value)
            : basis.div(new D(1).minus(value.div(100)));
  }
  return {
    market: marketBasis,
    replacementCost: priceString(replacement),
    adjustedReplacementCost: priceString(adjusted),
    pricingCost: priceString(basis),
    suggestedPrice: priceString(suggestion, true),
    warning,
  };
}
