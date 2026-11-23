import { describe, expect, it } from 'vitest';
import { emptyMaterial } from '../../src/lib/material-defaults';
import {
  autoFillMaterialSalePrices,
  baseSalePricesFromGram,
  editMaterial,
  initializeMaterialPricing,
  lossCompensatedPrice,
  recalculateMaterial,
} from '../../src/lib/material-calculations';
import { bulkSaleValues } from '../../src/lib/material-bulk';
import { materialLossRateSchema, materialSchema } from '../../src/lib/validation';
import { suggestedMaterialQuote } from '../../src/lib/product-diy-quote';

const values = () =>
  initializeMaterialPricing({
    ...emptyMaterial(),
    name: '货损验证',
    categoryId: 'clx1234567890123456789012',
    unit: 'STRAND',
    purchaseUnitPrice: '100.00',
    weightGrams: '20.00',
    childCount: 10,
    childPriceSource: 'COUNT',
    saleRule: 'PERCENT_30',
  });

describe('material loss allowance', () => {
  it('converts base gram prices and automatically fills final prices after adoption', () => {
    const draft = editMaterial(
      {
        ...recalculateMaterial(values()),
        childWeightGrams: '1.25',
        saleUnitPrice: '150.00',
        saleChildUnitPrice: '15.00',
        lossRate: '10.00',
      },
      'baseSaleGramPrice',
      '40.00',
    );
    const suggestions = baseSalePricesFromGram(draft);
    expect(suggestions).toEqual({
      unitPrice: '800.00',
      childPrice: '50.00',
      childUsesAverageWeight: false,
    });
    expect(draft).toMatchObject({ baseSaleUnitPrice: '130.00', baseSaleChildUnitPrice: '13.00' });
    const adopted = editMaterial(draft, 'baseSaleUnitPrice', suggestions.unitPrice);
    expect(adopted).toMatchObject({
      saleRule: 'CUSTOM_AMOUNT',
      baseSaleUnitPrice: '800.00',
      baseSaleChildUnitPrice: '13.00',
      saleUnitPrice: '888.89',
      saleChildUnitPrice: '14.45',
    });
    expect(lossCompensatedPrice(adopted.baseSaleUnitPrice!, adopted.lossRate!)).toBe('888.89');
    expect(editMaterial(adopted, 'baseSaleChildUnitPrice', suggestions.childPrice)).toMatchObject({
      baseSaleChildUnitPrice: '50.00',
      saleChildUnitPrice: '55.56',
    });
  });

  it('uses unrounded average bead weight when no measured weight exists', () => {
    const draft = {
      ...values(),
      saleRule: 'CUSTOM_AMOUNT' as const,
      baseSaleGramPrice: '40.00',
      weightGrams: '1.00',
      childCount: 3,
    };
    expect(baseSalePricesFromGram(draft)).toEqual({
      unitPrice: '40.00',
      childPrice: '13.33',
      childUsesAverageWeight: true,
    });
    expect(baseSalePricesFromGram({ ...draft, childWeightGrams: '0.33' }).childPrice).toBe('13.20');
    expect(
      baseSalePricesFromGram({ ...draft, baseSaleGramPrice: '0.05', childCount: 2 }).childPrice,
    ).toBe('0.03');
    expect(baseSalePricesFromGram({ ...draft, unit: 'BEAD' })).toMatchObject({
      unitPrice: '40.00',
      childPrice: null,
      childUsesAverageWeight: false,
    });
    expect(baseSalePricesFromGram({ ...draft, unit: 'GRAM' })).toMatchObject({
      unitPrice: null,
      childPrice: null,
    });
  });

  it('requires positive weight and valid counts and enforces price range and cent precision', () => {
    const draft = { ...values(), saleRule: 'CUSTOM_AMOUNT' as const, baseSaleGramPrice: '40.00' };
    for (const weightGrams of [null, '0', '-1', 'invalid']) {
      expect(baseSalePricesFromGram({ ...draft, weightGrams })).toMatchObject({
        unitPrice: null,
        childPrice: null,
      });
    }
    for (const childCount of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(baseSalePricesFromGram({ ...draft, childCount }).childPrice).toBeNull();
    }
    for (const baseSaleGramPrice of [null, 'invalid', '9999999999.99', '0.01']) {
      const weightGrams = baseSaleGramPrice === '0.01' ? '0.01' : '20.00';
      expect(
        baseSalePricesFromGram({ ...draft, baseSaleGramPrice, weightGrams }).unitPrice,
      ).toBeNull();
    }
    expect(baseSalePricesFromGram({ ...draft, baseSaleGramPrice: '0.00' })).toMatchObject({
      unitPrice: '0.00',
      childPrice: '0.00',
    });
    expect(baseSalePricesFromGram({ ...draft, childWeightGrams: '0.00' }).childPrice).toBeNull();
    expect(
      baseSalePricesFromGram({ ...draft, weightGrams: null, childWeightGrams: '2.00' }),
    ).toMatchObject({ unitPrice: null, childPrice: '80.00' });
  });

  it('spreads lost revenue over remaining stock and rounds upward to cents', () => {
    expect(lossCompensatedPrice('130.00', '10')).toBe('144.45');
    expect(lossCompensatedPrice('100.00', '10')).toBe('111.12');
    expect(lossCompensatedPrice('0.29', '50')).toBe('0.58');
    expect(lossCompensatedPrice('0.01', '0.01')).toBe('0.02');
    expect(lossCompensatedPrice('0.00', '99.99')).toBe('0.00');
    expect(lossCompensatedPrice('1.00', null)).toBe('1.00');
    expect(lossCompensatedPrice('1.00', '0')).toBe('1.00');
  });

  it('rejects invalid percentages, missing prices and amounts beyond database precision', () => {
    for (const rate of ['100', '100.01', '-1', '1.234', 'bad']) {
      expect(materialLossRateSchema.safeParse(rate).success).toBe(false);
      expect(lossCompensatedPrice('1.00', rate)).toBeNull();
    }
    expect(materialLossRateSchema.safeParse('99.99').success).toBe(true);
    expect(lossCompensatedPrice(null, '10')).toBeNull();
    expect(lossCompensatedPrice('9999999999.99', '0.01')).toBeNull();
    expect(lossCompensatedPrice('9999999999.99', '0')).toBe('9999999999.99');
  });

  it('automatically fills rule-based prices with or without a loss rate', () => {
    for (const lossRate of [null, '0', '10']) {
      const priced = autoFillMaterialSalePrices({ ...values(), lossRate });
      expect(priced).toMatchObject({
        baseSaleUnitPrice: '130.00',
        baseSaleGramPrice: '7.00',
        baseSaleChildUnitPrice: '13.00',
        saleUnitPrice: lossRate === '10' ? '144.45' : '130.00',
        saleGramPrice: lossRate === '10' ? '7.78' : '7.00',
        saleChildUnitPrice: lossRate === '10' ? '14.45' : '13.00',
        saleUnitManual: false,
      });
    }
  });

  it('recalculates automatic prices with cost changes while retaining a direct final-price edit', () => {
    const priced = autoFillMaterialSalePrices({ ...values(), lossRate: '20' });
    expect(editMaterial(priced, 'purchaseUnitPrice', '200.00').saleUnitPrice).toBe('325.00');
    const manual = editMaterial(priced, 'saleUnitPrice', '144.45');
    expect(editMaterial(manual, 'purchaseUnitPrice', '200.00')).toMatchObject({
      baseSaleUnitPrice: '260.00',
      saleUnitPrice: '144.45',
      saleUnitManual: true,
    });
    expect(editMaterial(manual, 'saleRule', 'PERCENT_50')).toMatchObject({
      baseSaleUnitPrice: '150.00',
      saleUnitPrice: '187.50',
      saleUnitManual: false,
    });
  });

  it('fills the saved gram price from custom base pricing, including reopening a missing price', () => {
    const gram = autoFillMaterialSalePrices({
      ...values(),
      unit: 'GRAM',
      saleRule: 'CUSTOM_AMOUNT',
      baseSaleGramPrice: '40.00',
      saleGramManual: true,
      saleGramPrice: null,
    });
    expect(gram).toMatchObject({
      saleGramPrice: '40.00',
      saleUnitPrice: '40.00',
      saleGramManual: false,
    });
    const changed = editMaterial(gram, 'baseSaleGramPrice', '50.00');
    expect(changed).toMatchObject({ saleGramPrice: '50.00', saleUnitPrice: '50.00' });
    const compensated = editMaterial(changed, 'lossRate', '10');
    expect(compensated).toMatchObject({ saleGramPrice: '55.56', saleUnitPrice: '55.56' });
    expect(editMaterial(compensated, 'lossRate', null).saleGramPrice).toBe('50.00');
    const zero = editMaterial(compensated, 'baseSaleGramPrice', '0.00');
    expect(zero.saleGramPrice).toBe('0.00');
    expect(
      editMaterial(compensated, 'baseSaleGramPrice', '9999999999.99').saleGramPrice,
    ).toBeNull();
  });

  it('automatically fills every supported pricing rule for each inventory unit', () => {
    const rules = [
      ['COST', null, '25.00'],
      ['PERCENT_30', null, '33.00'],
      ['PERCENT_50', null, '38.00'],
      ['PERCENT_60', null, '40.00'],
      ['FIXED_AMOUNT', '5.00', '30.00'],
      ['CUSTOM_PERCENT', '20.00', '30.00'],
      ['CUSTOM_AMOUNT', null, '40.00'],
    ] as const;
    for (const unit of ['GRAM', 'BEAD', 'STRAND'] as const) {
      for (const [saleRule, saleRuleValue, expected] of rules) {
        for (const lossRate of [null, '0', '10']) {
          const priced = autoFillMaterialSalePrices(
            {
              ...values(),
              unit,
              purchaseUnitPrice: '25.00',
              purchaseGramPrice: '25.00',
              purchaseGramManual: true,
              saleRule,
              saleRuleValue,
              lossRate,
              baseSaleUnitPrice: '40.00',
              baseSaleGramPrice: '40.00',
            },
            true,
          );
          expect(priced.saleUnitPrice, `${unit}/${saleRule}/${lossRate}`).toBe(
            lossCompensatedPrice(expected, lossRate),
          );
        }
      }
    }
  });

  it('never compounds loss when adopting repeatedly or reopening a saved draft', () => {
    const basis = editMaterial(values(), 'baseSaleUnitPrice', '130.00');
    let draft = editMaterial(basis, 'lossRate', '10');
    for (let i = 0; i < 3; i++) {
      draft = editMaterial(
        draft,
        'saleUnitPrice',
        lossCompensatedPrice(draft.baseSaleUnitPrice!, draft.lossRate!),
      );
      draft = recalculateMaterial(initializeMaterialPricing(JSON.parse(JSON.stringify(draft))));
      expect(draft.baseSaleUnitPrice).toBe('130.00');
      expect(draft.saleUnitPrice).toBe('144.45');
    }
    let automatic = editMaterial(basis, 'lossRate', '10');
    for (let i = 0; i < 3; i++) {
      automatic = autoFillMaterialSalePrices(
        initializeMaterialPricing(JSON.parse(JSON.stringify(automatic))),
      );
      expect(automatic).toMatchObject({
        baseSaleUnitPrice: '130.00',
        saleUnitPrice: '144.45',
        saleUnitManual: false,
      });
    }
    expect(editMaterial(draft, 'lossRate', '0').saleUnitPrice).toBe('130.00');
  });

  it('switches base prices to custom pricing and fills the corresponding final price', () => {
    const original = editMaterial(recalculateMaterial(values()), 'saleUnitPrice', '150.00');
    const changed = editMaterial(original, 'baseSaleUnitPrice', '120.50');
    expect(changed).toMatchObject({
      saleRule: 'CUSTOM_AMOUNT',
      saleRuleValue: null,
      baseSaleUnitPrice: '120.50',
      baseSaleGramPrice: '7.00',
      saleUnitPrice: '120.50',
    });
    expect(editMaterial(changed, 'purchaseUnitPrice', '500.00').baseSaleUnitPrice).toBe('120.50');
  });

  it('uses fixed markup before applying loss and automatically updates final prices', () => {
    const changed = editMaterial(
      { ...values(), saleUnitPrice: '150.00', saleRule: 'FIXED_AMOUNT', saleRuleValue: '20.00' },
      'saleRuleValue',
      '30.00',
    );
    expect(changed.baseSaleUnitPrice).toBe('130.00');
    expect(changed.saleUnitPrice).toBe('130.00');
    expect(lossCompensatedPrice(changed.baseSaleUnitPrice!, '10')).toBe('144.45');
  });

  it('keeps gram prices canonical and removes child pricing when changing units', () => {
    const gram = recalculateMaterial({
      ...values(),
      unit: 'GRAM',
      purchaseGramPrice: '8.00',
      saleGramPrice: '12.50',
    });
    expect(gram).toMatchObject({
      baseSaleUnitPrice: '11.00',
      baseSaleGramPrice: '11.00',
      saleUnitPrice: '12.50',
      saleGramPrice: '12.50',
      baseSaleChildUnitPrice: null,
    });
    expect(materialSchema.safeParse({ ...gram, imageKeys: [] }).success).toBe(true);
  });

  it('keeps DIY quotes on actual prices, including custom prices below the suggestion', () => {
    const entry = editMaterial(values(), 'saleChildUnitPrice', '2.00');
    expect(suggestedMaterialQuote({ material: { unit: 'STRAND' }, entry }, 'BEAD')).toBe('2.00');
    expect(materialSchema.safeParse({ ...entry, imageKeys: [] }).success).toBe(true);
  });

  it('keeps explicit bulk repricing and gram custom actual prices functional', () => {
    expect(bulkSaleValues(values(), { rule: 'PERCENT_50' })).toMatchObject({
      baseSaleUnitPrice: '150.00',
      saleUnitPrice: '150.00',
      saleUnitManual: false,
    });
    expect(
      bulkSaleValues(
        { ...values(), unit: 'GRAM', saleGramPrice: '9.00' },
        {
          rule: 'CUSTOM_AMOUNT',
          prices: { GRAM: { saleGramPrice: '12.50' } },
        },
      ),
    ).toMatchObject({ saleUnitPrice: '12.50', saleGramPrice: '12.50' });
  });
});
