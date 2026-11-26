import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIY_COMMON_FEES,
  commonFeeChoices,
  diyCommonFeesSchema,
  toggleCommonFee,
} from '../../src/lib/diy-common-fees';
import { calculateDiyCost, calculateDiyQuote } from '../../src/lib/product-diy-cost';
import { productDiySchema } from '../../src/lib/validation';

describe('DIY common fees', () => {
  it('adds a selected fee once and removes only that fee when unchecked', () => {
    const manual = { name: '其他', amount: '3', quoteAmount: '5' };
    const packaging = DEFAULT_DIY_COMMON_FEES[0];
    const selected = toggleCommonFee([manual], packaging, true);
    expect(selected).toHaveLength(2);
    expect(selected[1].quantity).toBe(1);
    expect(toggleCommonFee(selected, packaging, true)).toEqual(selected);
    expect(toggleCommonFee(selected, packaging, false)).toEqual([manual]);
  });

  it('preserves selected names and prices after presets are edited or deleted', () => {
    const packaging = DEFAULT_DIY_COMMON_FEES[0];
    const selected = toggleCommonFee([], packaging, true).map((cost) => ({
      ...cost,
      amount: '8',
      quoteAmount: '15',
    }));
    const edited = [{ ...packaging, name: '新包装', amount: '12' }];
    expect(commonFeeChoices(edited, selected)[0].name).toBe('包装费');
    expect(commonFeeChoices([], selected)[0]).toMatchObject({
      id: 'packaging',
      name: '包装费',
      amount: '8',
      quoteAmount: '15',
    });
    expect(toggleCommonFee(selected, edited[0], true)).toEqual(selected);
  });

  it('saves preset IDs and totals cost and customer amounts independently per item', () => {
    const input = {
      origin: 'DIY' as const,
      quantity: 2,
      notes: '',
      materials: [],
      cabochons: [],
      extraCosts: [
        { commonFeeId: 'packaging', name: '包装费', amount: '8', quoteAmount: '15' },
        { commonFeeId: 'shipping', name: '快递费', amount: '10', quoteAmount: '0' },
      ],
    };
    const saved = productDiySchema.parse(input);
    expect(saved.extraCosts).toEqual(input.extraCosts);
    expect(calculateDiyCost(saved)).toEqual({ perUnitCost: '18.00', totalCost: '36.00' });
    expect(calculateDiyQuote(saved)).toEqual({ perUnitQuote: '15.00', totalQuote: '30.00' });
    expect(
      productDiySchema.safeParse({ ...input, extraCosts: [{ name: '旧费用', amount: '2' }] })
        .success,
    ).toBe(true);
  });

  it('persists usage quantities and multiplies independent unit prices before batch quantity', () => {
    const input = {
      origin: 'DIY' as const,
      quantity: 2,
      notes: '',
      materials: [],
      cabochons: [],
      extraCosts: [
        { commonFeeId: 'bead', name: '定位珠', quantity: 3, amount: '2.01', quoteAmount: '4.05' },
        { name: '旧包装费', amount: '10', quoteAmount: '15' },
      ],
    };
    const saved = productDiySchema.parse(JSON.parse(JSON.stringify(input)));
    expect(saved.extraCosts).toEqual(input.extraCosts);
    expect(calculateDiyCost(saved)).toEqual({ perUnitCost: '16.03', totalCost: '32.06' });
    expect(calculateDiyQuote(saved)).toEqual({ perUnitQuote: '27.15', totalQuote: '54.30' });
    const free = {
      ...saved,
      extraCosts: [{ ...saved.extraCosts[0], amount: '0', quoteAmount: '0' }],
    };
    expect(calculateDiyCost(free)?.totalCost).toBe('0.00');
    expect(calculateDiyQuote(free)?.totalQuote).toBe('0.00');
    expect(
      calculateDiyQuote({ ...saved, extraCosts: [{ ...saved.extraCosts[0], quoteAmount: null }] }),
    ).toBeNull();
  });

  it('rejects invalid usage quantities and per-item cost overflow', () => {
    const input = {
      origin: 'DIY' as const,
      quantity: 1,
      notes: '',
      materials: [],
      cabochons: [],
      extraCosts: [],
    };
    for (const quantity of [0, -1, 1.5, 2147483648, NaN, Infinity]) {
      const invalid = {
        ...input,
        extraCosts: [{ name: '费用', quantity, amount: '2', quoteAmount: '3' }],
      };
      expect(productDiySchema.safeParse(invalid).success).toBe(false);
      expect(calculateDiyCost(invalid)).toBeNull();
      expect(calculateDiyQuote(invalid)).toBeNull();
    }
    expect(
      productDiySchema.safeParse({
        ...input,
        extraCosts: [{ name: '费用', quantity: 2, amount: '9999999999.99' }],
      }).success,
    ).toBe(false);
  });

  it('accepts empty configuration and zero amounts but rejects duplicate names and bad amounts', () => {
    expect(diyCommonFeesSchema.parse([])).toEqual([]);
    const fee = { ...DEFAULT_DIY_COMMON_FEES[0], amount: '0', quoteAmount: '0' };
    expect(diyCommonFeesSchema.safeParse([fee]).success).toBe(true);
    for (const fees of [
      [fee, { ...fee, id: 'other' }],
      [fee, { ...fee, name: '其他' }],
      [{ ...fee, name: '  ' }],
      [{ ...fee, amount: '-1' }],
      [{ ...fee, quoteAmount: '10.001' }],
      Array.from({ length: 51 }, (_, index) => ({
        ...fee,
        id: String(index),
        name: String(index),
      })),
    ])
      expect(diyCommonFeesSchema.safeParse(fees).success).toBe(false);
  });
});
