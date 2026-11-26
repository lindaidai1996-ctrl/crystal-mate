import { describe, expect, it } from 'vitest';
import { calculateScheme, parseFormula, type Variables } from '@/lib/price-schemes/formula';
import { priceContext } from '@/lib/price-schemes/variables';
const values: Variables = { cost: '100', costWithLabor: '120', quote: '180', direct: '200' };
describe('price scheme formula evaluation', () => {
  it.each([
    ['direct / (1 - 5%)', 21053],
    ['直售价 × 90%', 18000],
    ['(单件成本合计＋手工费) * 1.5', 18000],
    ['cost + 0.1 + 0.2', 10030],
    ['1 / 3 * 3', 100],
    ['-1 + 2', 100],
    ['1.005', 101],
    ['0', 0],
    ['200 * 1.05', 21000],
    ['10 - 2 * 3', 400],
    ['(10 - 2) * 3', 2400],
  ])('calculates %s exactly', (formula, expected) =>
    expect(calculateScheme(formula, 'CENT', values)).toEqual({
      amountCents: expected,
      error: null,
    }),
  );
  it.each([
    ['YUAN_UP', 21100],
    ['TEN_UP', 22000],
  ] as const)('rounds up using %s', (rounding, expected) =>
    expect(calculateScheme('direct / 0.95', rounding, values).amountCents).toBe(expected),
  );
  it.each([
    'globalThis.process',
    'cost; 10',
    'direct()',
    'direct ** 2',
    '(direct',
    '',
    'unknown',
    '1e5',
    '1..2',
    '5%%',
    '()',
  ])('rejects unsupported syntax %s', (formula) =>
    expect(calculateScheme(formula, 'CENT', values).error).toBe('SYNTAX'),
  );
  it('rejects excessive tokens', () =>
    expect(() => parseFormula(Array(200).fill('1').join('+'))).toThrow());
  it('handles invalid results without returning stale prices', () => {
    expect(calculateScheme('1 / 0', 'CENT', values)).toEqual({
      amountCents: null,
      error: 'DIVISION_ZERO',
    });
    expect(calculateScheme('-0.001', 'CENT', values).error).toBe('RANGE');
    expect(calculateScheme('21474836.48', 'CENT', values).error).toBe('RANGE');
    expect(calculateScheme('21474836.47', 'YUAN_UP', values).error).toBe('RANGE');
  });
  it('requires only referenced variables and keeps zero distinct from missing', () => {
    expect(calculateScheme('direct', 'CENT', { ...values, cost: null }).amountCents).toBe(20000);
    expect(calculateScheme('cost', 'CENT', { ...values, cost: null }).error).toBe('MISSING');
    expect(calculateScheme('cost', 'CENT', { ...values, cost: '0' }).amountCents).toBe(0);
    expect(calculateScheme('quote', 'CENT', values, ['cost', 'direct']).error).toBe(
      'NOT_APPLICABLE',
    );
  });
});
const draft = {
  origin: 'DIY' as const,
  quantity: 3,
  materials: [],
  cabochons: [],
  pricingLines: [],
  extraCosts: [{ name: 'fee', amount: '100', quoteAmount: '150' }],
  notes: '',
  craftDesignFee: { unitAmount: '1', accumulateByQuantity: false, totalAmount: null },
};
describe('per-item scheme variables', () => {
  it('keeps once-per-run labor exact until final rounding', () => {
    const context = priceContext(false, null, draft, '200');
    expect(context.values.cost).toBe('100.00');
    expect(context.values.quote).toBe('150.33');
    expect(calculateScheme('(costWithLabor - cost) * 3', 'CENT', context.values).amountCents).toBe(
      100,
    );
  });
  it('uses per-item labor or a manually set batch labor total', () => {
    const perItem = priceContext(
      false,
      null,
      { ...draft, craftDesignFee: { ...draft.craftDesignFee, accumulateByQuantity: true } },
      '200',
    );
    expect(calculateScheme('costWithLabor', 'CENT', perItem.values).amountCents).toBe(10100);
    const manual = priceContext(
      false,
      null,
      {
        ...draft,
        craftDesignFee: { ...draft.craftDesignFee, accumulateByQuantity: true, totalAmount: '15' },
      },
      '200',
    );
    expect(calculateScheme('costWithLabor', 'CENT', manual.values).amountCents).toBe(10500);
  });
  it('uses latest saved cost with deterministic ties and does not consult live materials', () => {
    const source = {
      origin: 'DIY' as const,
      purchaseEntries: [],
      diyRuns: ['a', 'b'].map((id) => ({
        id,
        createdAt: '2026-11-26',
        perUnitCost: id === 'b' ? '50' : '20',
        perUnitQuote: '70',
        quantity: 1,
        craftDesignFee: draft.craftDesignFee,
      })),
    };
    expect(priceContext(false, null, source, '200').values.cost).toBe('50');
  });
  it('uses recorded cabochon and purchase costs without inventing labor/quotes', () => {
    const source = {
      origin: 'PURCHASED' as const,
      purchaseEntries: [{ id: 'a', createdAt: '2026-11-26', unitCost: '75' }],
      diyRuns: [],
    };
    const purchase = priceContext(false, null, source, '200');
    expect(purchase.values).toEqual({
      cost: '75',
      costWithLabor: null,
      quote: null,
      direct: '200',
    });
    const egg = priceContext(
      true,
      {
        roughStoneCost: '10',
        settingCost: '5',
        otherCosts: [],
        totalManual: true,
        totalCost: '18',
      },
      source,
      '200',
    );
    expect(egg.values.cost).toBe('18');
    expect(egg.applicable).toEqual(['cost', 'direct']);
  });
});
