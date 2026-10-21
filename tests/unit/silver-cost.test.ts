import { describe, expect, it } from 'vitest';
import { calculateDiyCost, calculateDiyQuote } from '../../src/lib/product-diy-cost';
import { customerDiyDetails } from '../../src/lib/product-diy-quote';
import { diyQuotePricing } from '../../src/lib/product-pricing';
import { silverCostTotals } from '../../src/lib/silver-cost';
import { productDiySchema, silverPricingSchema } from '../../src/lib/validation';
import type { ProductDiyRun } from '../../src/lib/client-types';

const input = {
  origin: 'DIY' as const,
  quantity: 3,
  notes: '',
  materials: [],
  cabochons: [],
  extraCosts: [],
  silverCost: { weightGrams: '2.5', costGramPrice: '20', quoteGramPrice: '30' },
};

describe('DIY silver costs and quotes', () => {
  it('calculates per-item silver prices and run totals independently', () => {
    expect(silverCostTotals(input.silverCost)).toEqual({ cost: '50.00', quote: '75.00' });
    expect(calculateDiyCost(input)).toEqual({ perUnitCost: '50.00', totalCost: '150.00' });
    expect(calculateDiyQuote(input)).toEqual({ perUnitQuote: '75.00', totalQuote: '225.00' });
    expect(diyQuotePricing('150.00', '225.00')).toMatchObject({
      price: '225.00',
      saleRuleValue: '75.00',
    });
    expect(
      calculateDiyCost({ ...input, silverCost: { ...input.silverCost, quoteGramPrice: '99' } }),
    ).toEqual(calculateDiyCost(input));
    expect(
      calculateDiyQuote({ ...input, silverCost: { ...input.silverCost, costGramPrice: '99' } }),
    ).toEqual(calculateDiyQuote(input));
  });

  it('adds silver to other inputs without counting craft fees as internal cost', () => {
    const combined = {
      ...input,
      extraCosts: [{ name: '包装', amount: '2', quoteAmount: '5' }],
      craftDesignFee: { unitAmount: '100', accumulateByQuantity: false, totalAmount: null },
    };
    expect(calculateDiyCost(combined)?.totalCost).toBe('156.00');
    expect(calculateDiyQuote(combined)?.totalQuote).toBe('340.00');
  });

  it('rounds each item in exact minor units before multiplying by quantity', () => {
    const fractional = {
      ...input,
      silverCost: { weightGrams: '0.5', costGramPrice: '0.01', quoteGramPrice: '0.03' },
    };
    expect(silverCostTotals(fractional.silverCost)).toEqual({ cost: '0.01', quote: '0.02' });
    expect(calculateDiyCost(fractional)?.totalCost).toBe('0.03');
    expect(calculateDiyQuote(fractional)?.totalQuote).toBe('0.06');
  });

  it('supports no silver, legacy inputs, and explicit zero prices', () => {
    for (const silverCost of [
      undefined,
      { ...input.silverCost, weightGrams: '0' },
      { ...input.silverCost, costGramPrice: '0', quoteGramPrice: '0' },
    ]) {
      const source = { ...input, silverCost };
      expect(productDiySchema.safeParse(source).success).toBe(true);
      expect(calculateDiyCost(source)?.totalCost).toBe('0.00');
      expect(calculateDiyQuote(source)?.totalQuote).toBe('0.00');
    }
  });

  it('does not allow saving while database defaults have not loaded', () => {
    const pending = { ...input, silverCost: null };
    expect(productDiySchema.safeParse(pending).success).toBe(false);
    expect(calculateDiyCost(pending)).toBeNull();
    expect(calculateDiyQuote(pending)).toBeNull();
  });

  it('rejects invalid weights, rates and per-item cost overflow', () => {
    for (const field of ['weightGrams', 'costGramPrice', 'quoteGramPrice']) {
      for (const value of ['', '-1', '1.001', 'abc', '10000000000']) {
        expect(
          productDiySchema.safeParse({
            ...input,
            silverCost: { ...input.silverCost, [field]: value },
          }).success,
        ).toBe(false);
      }
    }
    expect(
      productDiySchema.safeParse({
        ...input,
        silverCost: { weightGrams: '9999999999.99', costGramPrice: '2', quoteGramPrice: '3' },
      }).success,
    ).toBe(false);
    expect(silverPricingSchema.safeParse({ costGramPrice: '20' }).success).toBe(false);
  });

  it('includes only customer-facing silver fields in quote details', () => {
    const run = {
      ...input,
      materialLines: [],
      cabochonLines: [],
      perUnitQuote: '75.00',
      totalQuote: '225.00',
      craftDesignFee: { unitAmount: '0', accumulateByQuantity: false, totalAmount: null },
    } as unknown as ProductDiyRun;
    const details = customerDiyDetails(run)!;
    expect(details.silver).toEqual({
      weightGrams: '2.5',
      quoteGramPrice: '30',
      subtotalPerItem: '75.00',
    });
    expect(JSON.stringify(details)).not.toContain('costGramPrice');
  });
});
