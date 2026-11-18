import { describe, expect, it } from 'vitest';
import { emptyMaterial } from '../../src/lib/material-defaults';
import {
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

  it('keeps cost-based base prices without filling or overwriting actual prices', () => {
    const priced = recalculateMaterial(values());
    expect(priced.baseSaleUnitPrice).toBe('130.00');
    expect(priced.baseSaleGramPrice).toBe('7.00');
    expect(priced.baseSaleChildUnitPrice).toBe('13.00');
    expect(priced.saleUnitPrice).toBeNull();
    const adopted = editMaterial(priced, 'saleUnitPrice', '144.45');
    const changed = editMaterial(
      editMaterial(adopted, 'lossRate', '20'),
      'purchaseUnitPrice',
      '200.00',
    );
    expect(changed.baseSaleUnitPrice).toBe('260.00');
    expect(changed.saleUnitPrice).toBe('144.45');
    expect(changed.purchaseUnitPrice).toBe('200.00');
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
    expect(editMaterial(draft, 'lossRate', '0').saleUnitPrice).toBe('144.45');
  });

  it('switches manual base prices to custom pricing while retaining actual prices and other bases', () => {
    const original = editMaterial(recalculateMaterial(values()), 'saleUnitPrice', '150.00');
    const changed = editMaterial(original, 'baseSaleUnitPrice', '120.50');
    expect(changed).toMatchObject({
      saleRule: 'CUSTOM_AMOUNT',
      saleRuleValue: null,
      baseSaleUnitPrice: '120.50',
      baseSaleGramPrice: '7.00',
      saleUnitPrice: '150.00',
    });
    expect(editMaterial(changed, 'purchaseUnitPrice', '500.00').baseSaleUnitPrice).toBe('120.50');
  });

  it('uses fixed markup before applying loss and preserves actual prices on rule changes', () => {
    const changed = editMaterial(
      { ...values(), saleUnitPrice: '150.00', saleRule: 'FIXED_AMOUNT', saleRuleValue: '20.00' },
      'saleRuleValue',
      '30.00',
    );
    expect(changed.baseSaleUnitPrice).toBe('130.00');
    expect(changed.saleUnitPrice).toBe('150.00');
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
