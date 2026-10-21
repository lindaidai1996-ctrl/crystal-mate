import { amountToCents, centsToAmount } from './cabochon-cost';

export type SilverPricing = {
  costGramPrice: string;
  quoteGramPrice: string;
};

export type SilverCost = SilverPricing & { weightGrams: string };

export const DEFAULT_SILVER_PRICING: SilverPricing = {
  costGramPrice: '20.00',
  quoteGramPrice: '30.00',
};

export function silverCostTotals(value: SilverCost) {
  const weight = amountToCents(value.weightGrams);
  const cost = amountToCents(value.costGramPrice);
  const quote = amountToCents(value.quoteGramPrice);
  if (weight === null || cost === null || quote === null) return null;
  return {
    cost: centsToAmount((weight * cost + BigInt(50)) / BigInt(100)),
    quote: centsToAmount((weight * quote + BigInt(50)) / BigInt(100)),
  };
}
