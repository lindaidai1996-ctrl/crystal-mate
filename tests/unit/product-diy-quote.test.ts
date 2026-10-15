import { describe, expect, it } from 'vitest';
import {
  calculateDiyCost,
  calculateDiyQuote,
  diyQuoteLineTotal,
} from '../../src/lib/product-diy-cost';
import { customerDiyDetails, suggestedMaterialQuote } from '../../src/lib/product-diy-quote';
import {
  diyQuotePricing,
  editProductPricing,
  productDiyQuote,
  recalculateProductPricing,
} from '../../src/lib/product-pricing';
import { productDiySchema } from '../../src/lib/validation';
import type { ProductDiyRun, ProductSourceInput } from '../../src/lib/client-types';

const input: Extract<ProductSourceInput, { origin: 'DIY' }> = {
  origin: 'DIY',
  quantity: 2,
  notes: 'internal note',
  materials: [
    {
      materialBatchEntryId: 'cm000000000000000000000001',
      usageUnit: 'BEAD',
      quantity: '10',
      unitCost: '2',
      quoteUnitPrice: '5',
    },
  ],
  cabochons: [
    { productId: 'cm000000000000000000000002', quantity: 1, unitCost: '20', quoteUnitPrice: '60' },
  ],
  extraCosts: [{ name: '配件', amount: '2', quoteAmount: '0' }],
  craftDesignFee: { unitAmount: '100', accumulateByQuantity: false, totalAmount: null },
};

describe('DIY customer quotes', () => {
  it('uses prices matching the material usage unit and preserves unknown prices', () => {
    const option = {
      entry: { saleUnitPrice: '100', saleChildUnitPrice: '5', saleGramPrice: '10' },
      material: { unit: 'STRAND' as const },
    };
    expect(suggestedMaterialQuote(option, 'STRAND')).toBe('100');
    expect(suggestedMaterialQuote(option, 'BEAD')).toBe('5');
    expect(suggestedMaterialQuote(option, 'GRAM')).toBe('10');
    expect(suggestedMaterialQuote({ ...option, material: { unit: 'BEAD' } }, 'BEAD')).toBe('100');
    expect(
      suggestedMaterialQuote(
        { ...option, entry: { ...option.entry, saleChildUnitPrice: null } },
        'BEAD',
      ),
    ).toBeNull();
  });

  it('calculates customer prices independently of cost, with a single run fee', () => {
    expect(calculateDiyCost(input)).toEqual({ perUnitCost: '42.00', totalCost: '84.00' });
    expect(calculateDiyQuote(input)).toEqual({ perUnitQuote: '160.00', totalQuote: '320.00' });
    expect(
      calculateDiyQuote({ ...input, materials: [{ ...input.materials[0], unitCost: '999' }] }),
    ).toEqual(calculateDiyQuote(input));
    expect(
      calculateDiyCost({ ...input, materials: [{ ...input.materials[0], quoteUnitPrice: '999' }] }),
    ).toEqual(calculateDiyCost(input));
    expect(
      calculateDiyQuote({
        ...input,
        craftDesignFee: { ...input.craftDesignFee!, accumulateByQuantity: true },
      }),
    ).toEqual({ perUnitQuote: '210.00', totalQuote: '420.00' });
    expect(
      calculateDiyQuote({
        ...input,
        craftDesignFee: {
          ...input.craftDesignFee!,
          accumulateByQuantity: true,
          totalAmount: '150',
        },
      }),
    ).toEqual({ perUnitQuote: '185.00', totalQuote: '370.00' });
  });

  it('allows saving costs with missing quotes and accepts an explicit zero', () => {
    for (const patch of [
      { materials: [{ ...input.materials[0], quoteUnitPrice: null }] },
      { cabochons: [{ ...input.cabochons[0], quoteUnitPrice: undefined }] },
      { extraCosts: [{ ...input.extraCosts[0], quoteAmount: null }] },
    ]) {
      const draft = { ...input, ...patch };
      expect(productDiySchema.safeParse(draft).success).toBe(true);
      expect(calculateDiyCost(draft)).not.toBeNull();
      expect(calculateDiyQuote(draft)).toBeNull();
    }
    expect(diyQuoteLineTotal('1', '0')).toBe('0.00');
    for (const price of ['-1', '1.001', 'abc']) {
      expect(
        productDiySchema.safeParse({
          ...input,
          materials: [{ ...input.materials[0], quoteUnitPrice: price }],
        }).success,
      ).toBe(false);
    }
  });

  it('rounds fractional lines before multiplying, and retains exact run fees', () => {
    expect(diyQuoteLineTotal('0.50', '0.01')).toBe('0.01');
    expect(
      calculateDiyQuote({
        ...input,
        quantity: 3,
        materials: [],
        cabochons: [],
        extraCosts: [],
        craftDesignFee: { unitAmount: '10', accumulateByQuantity: false, totalAmount: null },
      }),
    ).toEqual({ perUnitQuote: '3.33', totalQuote: '10.00' });
    expect(calculateDiyQuote({ ...input, quantity: 0 })).toBeNull();
  });

  it('selects the latest saved quote, never replacing it with a cost or older quote', () => {
    const old = {
      id: 'old',
      createdAt: '2026-10-14',
      perUnitCost: '1',
      quantity: 1,
      totalQuote: '50',
    };
    const newer = { ...old, id: 'new', createdAt: '2026-10-15', totalQuote: null };
    expect(productDiyQuote(input)).toBe('320.00');
    expect(
      productDiyQuote({ origin: 'DIY', purchaseEntries: [], diyRuns: [old, newer] }),
    ).toBeNull();
    expect(productDiyQuote({ origin: 'DIY', purchaseEntries: [], diyRuns: [old] })).toBe('50');
    expect(productDiyQuote({ origin: null, purchaseEntries: [], diyRuns: [] })).toBeUndefined();
  });

  it('defaults to a quote-based fixed amount and permits manual markup and price changes', () => {
    const pricing = diyQuotePricing('84.00', '320.00');
    expect(pricing).toEqual({
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: '236.00',
      saleManual: false,
      price: '320.00',
    });
    expect(diyQuotePricing('100', '420')).toMatchObject({
      saleRuleValue: '320.00',
      price: '420.00',
    });
    const manualMarkup = editProductPricing(pricing, '84', { saleRuleValue: '100' });
    expect(manualMarkup).toMatchObject({ saleRuleValue: '100', price: '184.00' });
    expect(recalculateProductPricing(manualMarkup, '90')).toMatchObject({
      saleRuleValue: '100',
      price: '190.00',
    });
    const manualPrice = editProductPricing(pricing, '84', { price: '199' });
    expect(recalculateProductPricing(manualPrice, '999').price).toBe('199');
    expect(diyQuotePricing('84', null)).toMatchObject({
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: null,
      price: null,
    });
    expect(diyQuotePricing('84', '21474836.48').price).toBeNull();
    expect(diyQuotePricing('84', '0')).toMatchObject({ saleRuleValue: '-84.00', price: '0.00' });
    expect(diyQuotePricing('0.03', '0.10')).toMatchObject({ saleRuleValue: '0.07', price: '0.10' });
  });

  it('projects customer fields without internal costs, live catalog data or notes', () => {
    const run = {
      quantity: 2,
      perUnitQuote: '160.00',
      totalQuote: '320.00',
      perUnitCost: '42.00',
      totalCost: '84.00',
      notes: 'internal note',
      craftDesignFee: input.craftDesignFee,
      extraCosts: input.extraCosts,
      materialLines: [
        {
          ...input.materials[0],
          quantity: '10',
          lineCost: '20',
          quoteUnitPrice: '5',
          quoteLineTotal: '50',
          quoteSnapshot: { name: '原物料名', lengthMm: '8', widthMm: null, heightMm: null },
          materialBatchEntry: {
            material: { name: '新物料名' },
            purchaseUnitPrice: '200',
            distributor: { name: '内部渠道' },
          },
        },
      ],
      cabochonLines: [
        {
          ...input.cabochons[0],
          lineCost: '20',
          quoteUnitPrice: '60',
          quoteLineTotal: '60',
          quoteSnapshot: {
            name: '原蛋面名',
            code: 'A1',
            lengthMm: null,
            widthMm: null,
            heightMm: null,
          },
        },
      ],
    } as unknown as ProductDiyRun;
    const details = customerDiyDetails(run)!;
    expect(details).toMatchObject({
      totalQuote: '320.00',
      craftDesignFee: '100.00',
      materials: [{ name: '原物料名', unitPrice: '5' }],
      cabochons: [{ name: '原蛋面名', unitPrice: '60' }],
      extraFees: [{ name: '配件', amountPerItem: '0' }],
    });
    const serialized = JSON.stringify(details);
    for (const internal of [
      'unitCost',
      'lineCost',
      'perUnitCost',
      'totalCost',
      'purchaseUnitPrice',
      'distributor',
      'notes',
      'internal note',
      '新物料名',
    ])
      expect(serialized).not.toContain(internal);
    expect(customerDiyDetails({ ...run, totalQuote: null })).toBeNull();
  });
});
