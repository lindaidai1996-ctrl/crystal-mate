import { amountToCents, centsToAmount } from './cabochon-cost';
import type { Product, ProductSourceInput } from './client-types';
import { calculateDiyCost, calculateDiyQuote, runAmountToCents } from './product-diy-cost';
import { maximumProductPriceCents, type ProductPricingValues } from './product-pricing';

export function savedDiySalePricing(product: Product | null): ProductPricingValues {
  return {
    saleRule: product?.saleRule ?? 'CUSTOM_AMOUNT',
    saleRuleValue: product?.saleRuleValue ?? null,
    saleManual: product?.saleManual ?? true,
    price: centsToAmount(BigInt(product?.priceCents ?? 0)),
  };
}

export function diySalePriceCents(value: string | null): number | null {
  const cents = value === null ? null : amountToCents(value);
  return cents !== null && cents <= maximumProductPriceCents ? Number(cents) : null;
}

export function signedDiyAmount(cents: bigint): string {
  return `${cents < BigInt(0) ? '-' : ''}${centsToAmount(cents < BigInt(0) ? -cents : cents)}`;
}

export function diySaleSummary(
  source: ProductSourceInput,
  price: string | null,
  currentPrice: number,
) {
  const cost = source.origin === 'DIY' ? (calculateDiyCost(source)?.perUnitCost ?? null) : null;
  const quote = source.origin === 'DIY' ? (calculateDiyQuote(source)?.perUnitQuote ?? null) : null;
  const priceCents = diySalePriceCents(price);
  const costCents = cost === null ? null : runAmountToCents(cost);
  const quoteCents = quote === null ? null : runAmountToCents(quote);
  return {
    cost,
    quote,
    priceCents,
    adoptable: quote !== null && diySalePriceCents(quote) !== null,
    difference: quoteCents === null ? null : signedDiyAmount(quoteCents - BigInt(currentPrice)),
    profit:
      priceCents === null || costCents === null
        ? null
        : signedDiyAmount(BigInt(priceCents) - costCents),
  };
}
