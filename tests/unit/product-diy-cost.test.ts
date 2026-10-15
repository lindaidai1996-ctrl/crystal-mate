import { describe, expect, it } from 'vitest';
import {
  calculateDiyCost,
  craftDesignFeeTotal,
  emptyCraftDesignFee,
} from '../../src/lib/product-diy-cost';
import { productPricingCost } from '../../src/lib/product-pricing';
import { productDiySchema } from '../../src/lib/validation';
import type { ProductSourceInput } from '../../src/lib/client-types';

const diy: Extract<ProductSourceInput, { origin: 'DIY' }> = {
  origin: 'DIY',
  quantity: 3,
  notes: '',
  materials: [],
  cabochons: [{ productId: 'cm000000000000000000000001', quantity: 1, unitCost: '20' }],
  extraCosts: [{ name: '配件', amount: '2' }],
};

describe('DIY craft and design costs', () => {
  it('calculates and validates fees without materials or cabochons', () => {
    const input = {
      ...diy,
      quantity: 2,
      cabochons: [],
      craftDesignFee: { unitAmount: '100', accumulateByQuantity: true, totalAmount: null },
    };
    expect(calculateDiyCost(input)).toEqual({ perUnitCost: '2.00', totalCost: '4.00' });
    expect(productDiySchema.safeParse(input).success).toBe(true);
    expect(productPricingCost(false, null, input).amount).toBe('4.00');
    expect(
      calculateDiyCost({
        ...input,
        craftDesignFee: {
          ...input.craftDesignFee,
          accumulateByQuantity: false,
        },
      }),
    ).toEqual({ perUnitCost: '2.00', totalCost: '4.00' });
    expect(
      calculateDiyCost({
        ...input,
        craftDesignFee: {
          ...input.craftDesignFee,
          totalAmount: '190',
        },
      }),
    ).toEqual({ perUnitCost: '2.00', totalCost: '4.00' });
    expect(calculateDiyCost({ ...input, extraCosts: [] })).toEqual({
      perUnitCost: '0.00',
      totalCost: '0.00',
    });
    expect(calculateDiyCost({ ...input, craftDesignFee: undefined })).toEqual({
      perUnitCost: '2.00',
      totalCost: '4.00',
    });
    const zero = { ...input, extraCosts: [], craftDesignFee: undefined };
    expect(calculateDiyCost(zero)).toEqual({ perUnitCost: '0.00', totalCost: '0.00' });
    expect(productDiySchema.safeParse(zero).success).toBe(true);
  });

  it('keeps legacy costs and defaults an omitted fee to zero', () => {
    expect(calculateDiyCost(diy)).toEqual({ perUnitCost: '22.00', totalCost: '66.00' });
    expect(productDiySchema.parse(diy).craftDesignFee).toBeUndefined();
    expect(craftDesignFeeTotal(emptyCraftDesignFee(), diy.quantity)).toBe('0.00');
  });

  it('excludes service fees from internal cost even when a manual total exists', () => {
    const input = {
      ...diy,
      craftDesignFee: { unitAmount: '10', accumulateByQuantity: false, totalAmount: '99' },
    };
    expect(calculateDiyCost(input)).toEqual({ perUnitCost: '22.00', totalCost: '66.00' });
    expect(productPricingCost(false, null, input).amount).toBe('66.00');
  });

  it('follows quantity and unit fee until a manual total is entered', () => {
    const fee = { unitAmount: '10', accumulateByQuantity: true, totalAmount: null };
    expect(craftDesignFeeTotal(fee, 3)).toBe('30.00');
    expect(craftDesignFeeTotal(fee, 4)).toBe('40.00');
    expect(craftDesignFeeTotal({ ...fee, unitAmount: '12.50' }, 4)).toBe('50.00');
    expect(calculateDiyCost({ ...diy, craftDesignFee: fee })).toEqual({
      perUnitCost: '22.00',
      totalCost: '66.00',
    });
    const manual = { ...fee, totalAmount: '25' };
    expect(calculateDiyCost({ ...diy, craftDesignFee: manual })).toEqual({
      perUnitCost: '22.00',
      totalCost: '66.00',
    });
    expect(craftDesignFeeTotal(manual, 4)).toBe('25.00');
    expect(craftDesignFeeTotal({ ...manual, unitAmount: '12' }, 4)).toBe('25.00');
    expect(craftDesignFeeTotal({ ...manual, totalAmount: '0' }, 4)).toBe('0.00');
    expect(craftDesignFeeTotal({ ...manual, totalAmount: null }, 4)).toBe('40.00');
  });

  it('prices saved runs from the exact total, with a legacy fallback', () => {
    const record = { id: 'run', createdAt: '2026-10-15', quantity: 3, perUnitCost: '25.33' };
    const source = { origin: 'DIY' as const, purchaseEntries: [], diyRuns: [record] };
    expect(productPricingCost(false, null, source).amount).toBe('75.99');
    expect(
      productPricingCost(false, null, {
        ...source,
        diyRuns: [{ ...record, totalCost: '76.00' }],
      }).amount,
    ).toBe('76.00');
  });

  it('rounds each material line without including the service fee', () => {
    expect(
      calculateDiyCost({
        ...diy,
        cabochons: [],
        extraCosts: [],
        materials: [
          {
            materialBatchEntryId: 'material',
            usageUnit: 'GRAM',
            quantity: '0.50',
            unitCost: '0.01',
          },
        ],
        craftDesignFee: { unitAmount: '0.02', accumulateByQuantity: false, totalAmount: null },
      }),
    ).toEqual({ perUnitCost: '0.01', totalCost: '0.03' });
  });

  it('rejects invalid fees and per-item overflow while allowing large valid run totals', () => {
    for (const change of [
      { unitAmount: '-1' },
      { unitAmount: '1.001' },
      { totalAmount: '-1' },
      { totalAmount: 'abc' },
    ]) {
      expect(
        productDiySchema.safeParse({
          ...diy,
          quantity: 1,
          craftDesignFee: {
            unitAmount: '0',
            accumulateByQuantity: true,
            totalAmount: null,
            ...change,
          },
        }).success,
      ).toBe(false);
    }
    const input = { ...diy, quantity: 0 };
    expect(calculateDiyCost(input)).toBeNull();
    expect(productDiySchema.safeParse(input).success).toBe(false);
    expect(
      productDiySchema.safeParse({
        ...diy,
        cabochons: [
          {
            ...diy.cabochons[0],
            quantity: 2,
            unitCost: '9999999999.99',
          },
        ],
      }).success,
    ).toBe(false);
    const large = {
      ...diy,
      quantity: 2147483647,
      craftDesignFee: {
        unitAmount: '9999990000',
        accumulateByQuantity: true,
        totalAmount: null,
      },
    };
    expect(productDiySchema.safeParse(large).success).toBe(true);
    expect(calculateDiyCost(large)?.totalCost).toBe('47244640234.00');
  });
});
