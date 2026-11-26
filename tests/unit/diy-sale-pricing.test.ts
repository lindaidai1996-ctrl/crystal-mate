import { describe, expect, it } from 'vitest';
import { diySalePriceCents, diySaleSummary } from '@/lib/diy-sale-pricing';
import { productSourceWriteSchema, sourceRulePriceChangeSchema } from '@/lib/product-source-write';
import { productPricingCost, productDiyQuote, calculateProductPrice } from '@/lib/product-pricing';

const source = {
  origin: 'DIY' as const,
  quantity: 3,
  materials: [],
  cabochons: [],
  extraCosts: [{ name: '费用', amount: '60', quoteAmount: '100', quantity: 3 }],
  craftDesignFee: { unitAmount: '384', accumulateByQuantity: false, totalAmount: null },
  notes: '',
};

describe('DIY sale pricing', () => {
  it('uses the same unit basis in new, saved and quick product editors', () => {
    const saved = {
      origin: 'DIY' as const,
      purchaseEntries: [],
      diyRuns: [
        {
          id: 'run',
          createdAt: '2026-11-26',
          quantity: 3,
          perUnitCost: '180.00',
          totalCost: '540.00',
          perUnitQuote: '428.00',
          totalQuote: '1284.00',
        },
      ],
    };
    const quick = diySaleSummary(source, '429', 38880);
    for (const input of [source, saved]) {
      expect(productPricingCost(false, null, input).amount).toBe(quick.cost);
      expect(productDiyQuote(input)).toBe(quick.quote);
      expect(
        calculateProductPrice(productPricingCost(false, null, input).amount, 'PERCENT_50', null),
      ).toBe('270.00');
    }
  });
  it('compares per-item cost and quote, rather than production totals', () => {
    expect(diySaleSummary(source, '429', 38880)).toEqual({
      cost: '180.00',
      quote: '428.00',
      priceCents: 42900,
      adoptable: true,
      difference: '39.20',
      profit: '249.00',
    });
  });

  it('keeps a manually entered sale price when cost and quote change', () => {
    const next = { ...source, extraCosts: [{ name: '费用', amount: '440', quoteAmount: '500' }] };
    expect(diySaleSummary(next, '429', 38880)).toMatchObject({
      priceCents: 42900,
      cost: '440.00',
      quote: '628.00',
      profit: '-11.00',
    });
  });

  it('does not invent a zero quote when a quote is missing', () => {
    const incomplete = { ...source, extraCosts: [{ name: '费用', amount: '20' }] };
    expect(diySaleSummary(incomplete, '30', 3000)).toMatchObject({
      quote: null,
      adoptable: false,
      difference: null,
      priceCents: 3000,
      profit: '10.00',
    });
  });

  it('supports a deliberate zero price and fractional losses', () => {
    const inexpensive = {
      ...source,
      extraCosts: [{ name: '费用', amount: '0.01', quoteAmount: '0' }],
      craftDesignFee: undefined,
    };
    expect(diySaleSummary(inexpensive, '0', 1)).toMatchObject({
      priceCents: 0,
      quote: '0.00',
      adoptable: true,
      difference: '-0.01',
      profit: '-0.01',
    });
  });

  it.each(['', '-1', '1.001', '21474836.48', '1e3', 'Infinity', '999999999999999999'])(
    'rejects invalid sale price %s without clamping',
    (value) => {
      expect(diySalePriceCents(value)).toBeNull();
    },
  );

  it('accepts the exact maximum and prevents adopting an oversized quote', () => {
    expect(diySalePriceCents('21474836.47')).toBe(2147483647);
    const large = {
      ...source,
      extraCosts: [{ name: '费用', amount: '1', quoteAmount: '9999999999.99' }],
    };
    expect(diySaleSummary(large, '1', 100)).toMatchObject({ adoptable: false, priceCents: 100 });
  });
});

describe('source and price request contract', () => {
  const pricing = { priceCents: 42900, expectedPriceCents: 38880 };
  const full = {
    ...pricing,
    saleRule: 'FIXED_AMOUNT',
    saleRuleValue: '20',
    saleManual: false,
    expectedPricing: { saleRule: 'PERCENT_50', saleRuleValue: null, saleManual: false },
  };

  it('requires complete rules and validates them like the full product form', () => {
    expect(sourceRulePriceChangeSchema.safeParse(full).success).toBe(true);
    for (const fields of [
      { saleRuleValue: null },
      { saleRule: 'CUSTOM_PERCENT', saleRuleValue: '-1' },
      { saleRule: 'CUSTOM_AMOUNT', saleRuleValue: null, saleManual: false },
      { saleRule: 'CUSTOM_AMOUNT', saleRuleValue: '1', saleManual: true },
      { expectedPricing: undefined },
    ])
      expect(sourceRulePriceChangeSchema.safeParse({ ...full, ...fields }).success).toBe(false);
    expect(
      sourceRulePriceChangeSchema.safeParse({ ...full, saleRuleValue: null, saleManual: true })
        .success,
    ).toBe(true);
  });

  it('keeps source-only clients compatible and never implies a price change', () => {
    expect(productSourceWriteSchema.parse(source)).toMatchObject({ source, pricing: undefined });
  });

  it('accepts an explicit DIY source and final sale price', () => {
    expect(productSourceWriteSchema.parse({ source, pricing })).toEqual({ source, pricing });
  });

  it.each([
    { ...pricing, priceCents: -1 },
    { ...pricing, priceCents: 2147483648 },
    { ...pricing, priceCents: 1.5 },
    { priceCents: 100 },
    { ...pricing, saleRule: 'COST' },
  ])('rejects invalid prices, missing baselines and unrelated fields', (invalid) => {
    expect(productSourceWriteSchema.safeParse({ source, pricing: invalid }).success).toBe(false);
  });
});
