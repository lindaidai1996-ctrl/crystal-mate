import {
  amountToCents,
  calculateCostTotal,
  centsToAmount,
  type CabochonCostValues,
} from './cabochon-cost';
import type { ProductSourceInput } from './client-types';
import { calculateDiyCost, calculateDiyQuote } from './product-diy-cost';

export const productSaleRules = [
  'COST',
  'PERCENT_30',
  'PERCENT_50',
  'PERCENT_100',
  'PERCENT_200',
  'FIXED_AMOUNT',
  'CUSTOM_PERCENT',
] as const;

export type ProductSaleRule = (typeof productSaleRules)[number];
export type ProductPricingValues = {
  saleRule: ProductSaleRule;
  saleRuleValue: string | null;
  saleManual: boolean;
  price: string | null;
};

export const maximumProductPriceCents = BigInt(2147483647);

function signedAmountToCents(value: string) {
  const negative = value.startsWith('-');
  const amount = amountToCents(negative ? value.slice(1) : value);
  return amount === null ? null : negative ? -amount : amount;
}

export function diyQuotePricing(cost: string | null, quote: string | null): ProductPricingValues {
  const costCents = cost === null ? null : amountToCents(cost);
  const quoteCents = quote === null ? null : amountToCents(quote);
  const difference = costCents === null || quoteCents === null ? null : quoteCents - costCents;
  const addition =
    difference === null
      ? null
      : `${difference < BigInt(0) ? '-' : ''}${centsToAmount(difference < BigInt(0) ? -difference : difference)}`;
  return {
    saleRule: 'FIXED_AMOUNT',
    saleRuleValue: addition,
    saleManual: false,
    price: calculateProductPrice(cost, 'FIXED_AMOUNT', addition),
  };
}

export function calculateProductPrice(
  cost: string | null,
  rule: ProductSaleRule,
  ruleValue: string | null,
): string | null {
  const cents = cost === null ? null : amountToCents(cost);
  if (cents === null) return null;
  let result: bigint;
  if (rule === 'FIXED_AMOUNT') {
    const addition = ruleValue === null ? null : signedAmountToCents(ruleValue);
    if (addition === null) return null;
    result = cents + addition;
  } else {
    const percentages = {
      COST: 0,
      PERCENT_30: 30,
      PERCENT_50: 50,
      PERCENT_100: 100,
      PERCENT_200: 200,
    };
    const percentage =
      rule === 'CUSTOM_PERCENT'
        ? ruleValue === null
          ? null
          : amountToCents(ruleValue)
        : BigInt(percentages[rule]) * BigInt(100);
    if (percentage === null) return null;
    result = (cents * (BigInt(10000) + percentage) + BigInt(5000)) / BigInt(10000);
  }
  return result >= BigInt(0) && result <= maximumProductPriceCents ? centsToAmount(result) : null;
}

export function recalculateProductPricing(value: ProductPricingValues, cost: string | null) {
  return value.saleManual
    ? value
    : { ...value, price: calculateProductPrice(cost, value.saleRule, value.saleRuleValue) };
}

export function editProductPricing(
  current: ProductPricingValues,
  cost: string | null,
  change: Partial<Pick<ProductPricingValues, 'saleRule' | 'saleRuleValue' | 'price'>>,
): ProductPricingValues {
  const next = { ...current, ...change };
  next.saleManual = 'price' in change ? change.price !== null : false;
  if ('saleRule' in change && change.saleRule !== current.saleRule) next.saleRuleValue = null;
  return recalculateProductPricing(next, cost);
}

type SourceRecord = { id: string; createdAt: string | Date };

function recordSummary(record: SourceRecord | undefined) {
  return record
    ? { id: record.id, createdAt: new Date(record.createdAt).toISOString() }
    : undefined;
}
type SavedSources = {
  origin: 'PURCHASED' | 'DIY' | null;
  purchaseEntries: Array<SourceRecord & { unitCost: string; batch: { name: string } }>;
  diyRuns: Array<
    SourceRecord & {
      perUnitCost: string;
      quantity: number;
      totalCost?: string | null;
      totalQuote?: string | null;
    }
  >;
};

function latest<T extends SourceRecord>(records: T[]): T | undefined {
  return [...records].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id),
  )[0];
}

export function productDiyQuote(
  source: ProductSourceInput | SavedSources,
): string | null | undefined {
  if (source.origin !== 'DIY') return undefined;
  return 'purchaseEntries' in source
    ? (latest(source.diyRuns)?.totalQuote ?? null)
    : (calculateDiyQuote(source)?.totalQuote ?? null);
}

export function productPricingCost(
  isCabochon: boolean,
  cost: CabochonCostValues | null | undefined,
  source: ProductSourceInput | SavedSources,
): {
  amount: string | null;
  kind: 'cabochon' | 'purchase' | 'diy' | 'missing';
  record?: { id: string; createdAt: string };
  batchName?: string;
} {
  if (isCabochon) {
    const amount = cost ? (cost.totalManual ? cost.totalCost : calculateCostTotal(cost)) : null;
    return { amount, kind: 'cabochon' };
  }
  if ('purchaseEntries' in source) {
    if (source.origin === 'PURCHASED') {
      const record = latest(source.purchaseEntries);
      return {
        amount: record?.unitCost ?? null,
        kind: 'purchase',
        record: recordSummary(record),
        batchName: record?.batch.name,
      };
    }
    if (source.origin === 'DIY') {
      const record = latest(source.diyRuns);
      const cents = record ? amountToCents(record.perUnitCost) : null;
      return {
        amount:
          record?.totalCost ??
          (record && cents !== null ? centsToAmount(cents * BigInt(record.quantity)) : null),
        kind: 'diy',
        record: recordSummary(record),
      };
    }
    return { amount: null, kind: 'missing' };
  }
  if (source.origin === 'PURCHASED') {
    const cents = amountToCents(source.unitCost);
    return { amount: cents === null ? null : centsToAmount(cents), kind: 'purchase' };
  }
  return {
    amount: calculateDiyCost(source)?.totalCost ?? null,
    kind: 'diy',
  };
}
