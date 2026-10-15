import { describe, expect, it } from 'vitest';
import {
  calculateCostTotal,
  hasCostInput,
  normalizeCostAmount,
  recalculateCabochonCost,
  withCostDetails,
  type CabochonCostValues,
} from '../../src/lib/cabochon-cost';
import { cabochonCostSchema, productSchema } from '../../src/lib/validation';

const blank: CabochonCostValues = {
  roughStoneCost: null,
  settingCost: null,
  otherCosts: [],
  totalCost: null,
  totalManual: false,
};

const product = {
  code: 'CAB-COST',
  name: '测试蛋面',
  description: '',
  categoryId: 'clx1234567890123456789012',
  priceCents: 100,
  currency: 'CNY',
  stock: 1,
  published: false,
  imageKeys: [],
};

describe('cabochon cost calculation', () => {
  it('sums decimal amounts exactly and formats every result to two places', () => {
    const cost = withCostDetails({
      ...blank,
      roughStoneCost: '0.10',
      settingCost: '0.20',
      otherCosts: [
        { name: '包装', amount: '1' },
        { name: '运费', amount: '0.03' },
      ],
    });
    expect(cost.totalCost).toBe('1.33');
    expect(normalizeCostAmount('1')).toBe('1.00');
    expect(calculateCostTotal({ ...cost, otherCosts: [] })).toBe('0.30');
  });

  it('keeps a manual total during detail edits and restores calculation on request', () => {
    const manual: CabochonCostValues = {
      ...blank,
      roughStoneCost: '1.00',
      totalCost: '8.88',
      totalManual: true,
    };
    const changed = withCostDetails({ ...manual, roughStoneCost: '2.00' });
    expect(changed.totalCost).toBe('8.88');
    expect(recalculateCabochonCost(changed)).toMatchObject({
      totalCost: '2.00',
      totalManual: false,
    });
    expect(hasCostInput(blank)).toBe(false);
    expect(hasCostInput({ ...blank, totalCost: '5.00', totalManual: true })).toBe(true);
  });
});

describe('cabochon cost validation', () => {
  const valid = {
    roughStoneCost: '1.00',
    settingCost: null,
    otherCosts: [{ name: '包装', amount: '0.25' }],
    totalCost: '1.25',
    totalManual: false,
  };

  it('accepts optional costs and manual total overrides', () => {
    expect(productSchema.safeParse({ ...product, cost: null }).success).toBe(true);
    expect(cabochonCostSchema.safeParse(valid).success).toBe(true);
    expect(
      cabochonCostSchema.safeParse({ ...valid, totalCost: '9.00', totalManual: true }).success,
    ).toBe(true);
  });

  it('rejects invalid amounts, incomplete rows, duplicate names, and total overflow', () => {
    for (const amount of ['-1', '1.234', '10000000000.00']) {
      expect(cabochonCostSchema.safeParse({ ...valid, roughStoneCost: amount }).success).toBe(
        false,
      );
    }
    expect(
      cabochonCostSchema.safeParse({ ...valid, otherCosts: [{ name: '包装', amount: null }] })
        .success,
    ).toBe(false);
    expect(
      cabochonCostSchema.safeParse({ ...valid, otherCosts: [{ name: '', amount: '1.00' }] })
        .success,
    ).toBe(false);
    expect(
      cabochonCostSchema.safeParse({
        ...valid,
        otherCosts: [
          { name: '包装', amount: '1.00' },
          { name: '包装 ', amount: '2.00' },
        ],
      }).success,
    ).toBe(false);
    expect(
      cabochonCostSchema.safeParse({
        ...valid,
        roughStoneCost: '9999999999.99',
        settingCost: '0.01',
      }).success,
    ).toBe(false);
  });
});
