import { describe, expect, it } from 'vitest';
import {
  calculateProductPrice,
  editProductPricing,
  productPricingCost,
  recalculateProductPricing,
  type ProductPricingValues,
} from '../../src/lib/product-pricing';
import { productSchema } from '../../src/lib/validation';

const automatic: ProductPricingValues = {
  saleRule: 'PERCENT_50',
  saleRuleValue: null,
  saleManual: false,
  price: null,
};
const purchase = {
  origin: 'PURCHASED' as const,
  selection: { batchId: 'batch' },
  distributorId: 'distributor',
  quantity: 5,
  unitCost: '100.00',
  notes: '',
};

describe('product pricing', () => {
  it.each([
    ['COST', null, '100.00'],
    ['PERCENT_30', null, '130.00'],
    ['PERCENT_50', null, '150.00'],
    ['PERCENT_100', null, '200.00'],
    ['PERCENT_200', null, '300.00'],
    ['FIXED_AMOUNT', '20.25', '120.25'],
    ['FIXED_AMOUNT', '-20.25', '79.75'],
    ['CUSTOM_PERCENT', '12.34', '112.34'],
  ] as const)('calculates %s as a markup', (rule, parameter, expected) => {
    expect(calculateProductPrice('100.00', rule, parameter)).toBe(expected);
  });

  it('rounds half cents up and enforces the stored integer price range', () => {
    expect(calculateProductPrice('0.01', 'PERCENT_50', null)).toBe('0.02');
    expect(calculateProductPrice('0.10', 'CUSTOM_PERCENT', '4.99')).toBe('0.10');
    expect(calculateProductPrice('0.10', 'CUSTOM_PERCENT', '5')).toBe('0.11');
    expect(calculateProductPrice('21474836.47', 'COST', null)).toBe('21474836.47');
    expect(calculateProductPrice('21474836.47', 'FIXED_AMOUNT', '0.01')).toBeNull();
    expect(calculateProductPrice('1000000000', 'PERCENT_200', null)).toBeNull();
    expect(calculateProductPrice('20', 'FIXED_AMOUNT', '-20.01')).toBeNull();
    expect(calculateProductPrice('0.10', 'FIXED_AMOUNT', '-0.01')).toBe('0.09');
  });

  it('distinguishes missing and invalid amounts from explicit zero', () => {
    for (const cost of [null, '', '-1', '1.001', 'abc']) {
      expect(calculateProductPrice(cost, 'PERCENT_50', null)).toBeNull();
    }
    expect(calculateProductPrice('0', 'PERCENT_50', null)).toBe('0.00');
    expect(calculateProductPrice('0', 'FIXED_AMOUNT', '20')).toBe('20.00');
    expect(calculateProductPrice('1', 'FIXED_AMOUNT', null)).toBeNull();
    expect(calculateProductPrice('1', 'CUSTOM_PERCENT', '-10')).toBeNull();
  });

  it('takes cabochon total cost ahead of source cost, including manual totals', () => {
    const cost = {
      roughStoneCost: '10',
      settingCost: '5',
      otherCosts: [],
      totalCost: '50',
      totalManual: true,
    };
    expect(productPricingCost(true, cost, purchase).amount).toBe('50');
    expect(productPricingCost(true, { ...cost, totalManual: false }, purchase).amount).toBe(
      '15.00',
    );
    expect(productPricingCost(true, null, purchase).amount).toBeNull();
    expect(productPricingCost(false, cost, purchase).amount).toBe('100.00');
  });

  it('uses purchase unit cost and DIY run total, rounding each material line first', () => {
    expect(productPricingCost(false, null, purchase).amount).toBe('100.00');
    const diy = {
      origin: 'DIY' as const,
      quantity: 3,
      notes: '',
      materials: [
        {
          materialBatchEntryId: 'material',
          usageUnit: 'GRAM' as const,
          quantity: '0.50',
          unitCost: '0.01',
        },
      ],
      cabochons: [{ productId: 'egg', quantity: 1, unitCost: '20' }],
      extraCosts: [{ name: 'parts', amount: '2' }],
    };
    expect(productPricingCost(false, null, diy).amount).toBe('66.03');
    expect(productPricingCost(false, null, { ...diy, quantity: 0 }).amount).toBeNull();
    expect(productPricingCost(false, null, { ...diy, materials: [], cabochons: [] }).amount).toBe(
      '6.00',
    );
  });

  it('selects latest creation rather than array order and falls back after deletion', () => {
    const old = {
      id: 'old',
      createdAt: '2026-10-12T00:00:00.000Z',
      unitCost: '10.00',
      batch: { name: 'Old batch' },
    };
    const newer = {
      id: 'new',
      createdAt: new Date('2026-10-13T00:00:00.000Z'),
      unitCost: '20.00',
      batch: { name: 'New batch' },
    };
    const sources = { origin: 'PURCHASED' as const, purchaseEntries: [old, newer], diyRuns: [] };
    expect(productPricingCost(false, null, sources)).toMatchObject({
      amount: '20.00',
      batchName: 'New batch',
      record: { id: 'new' },
    });
    expect(productPricingCost(false, null, { ...sources, purchaseEntries: [old] }).amount).toBe(
      '10.00',
    );
    expect(productPricingCost(false, null, { ...sources, purchaseEntries: [] }).amount).toBeNull();
    expect(
      productPricingCost(false, null, {
        ...sources,
        origin: 'DIY',
        diyRuns: [{ id: 'run', createdAt: old.createdAt, quantity: 3, perUnitCost: '32.00' }],
      }).amount,
    ).toBe('96.00');
  });

  it('keeps manual prices until a rule, parameter or cleared price restores automation', () => {
    const calculated = recalculateProductPricing(automatic, '100');
    expect(calculated.price).toBe('150.00');
    const manual = editProductPricing(calculated, '100', { price: '199.00' });
    expect(recalculateProductPricing(manual, '200').price).toBe('199.00');
    expect(editProductPricing(manual, '200', { price: null })).toMatchObject({
      saleManual: false,
      price: '300.00',
    });
    expect(editProductPricing(manual, '200', { saleRule: 'PERCENT_50' })).toMatchObject({
      saleManual: false,
      price: '300.00',
    });
    const fixed = editProductPricing(manual, '100', { saleRule: 'FIXED_AMOUNT' });
    expect(fixed.price).toBeNull();
    expect(
      editProductPricing({ ...fixed, saleManual: true, price: '199' }, '100', {
        saleRuleValue: '20',
      }),
    ).toMatchObject({ saleManual: false, price: '120.00' });
    expect(recalculateProductPricing(calculated, null).price).toBeNull();
  });

  it('accepts legacy requests but requires complete new pricing fields', () => {
    const base = {
      code: 'A1',
      name: 'Test',
      description: '',
      categoryId: 'cm000000000000000000000001',
      priceCents: 100,
      currency: 'CNY',
      stock: 1,
      published: false,
      imageKeys: [],
    };
    expect(productSchema.safeParse(base).success).toBe(true);
    expect(
      productSchema.safeParse({
        ...base,
        saleRule: 'FIXED_AMOUNT',
        saleRuleValue: '-10',
        saleManual: false,
      }).success,
    ).toBe(true);
    expect(productSchema.safeParse({ ...base, saleRule: 'PERCENT_50' }).success).toBe(false);
    expect(
      productSchema.safeParse({
        ...base,
        saleRule: 'FIXED_AMOUNT',
        saleRuleValue: null,
        saleManual: false,
      }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({
        ...base,
        saleRule: 'FIXED_AMOUNT',
        saleRuleValue: null,
        saleManual: true,
      }).success,
    ).toBe(true);
    expect(
      productSchema.safeParse({
        ...base,
        saleRule: 'PERCENT_10',
        saleRuleValue: null,
        saleManual: false,
      }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({
        ...base,
        saleRule: 'PERCENT_50',
        saleRuleValue: '-1',
        saleManual: false,
      }).success,
    ).toBe(false);
  });
});
