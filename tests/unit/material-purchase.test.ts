import { describe, expect, it } from 'vitest';
import type { MaterialValues } from '../../src/lib/client-types';
import {
  calculatePurchase,
  editPurchase,
  emptyPurchase,
  resolvePurchase,
} from '../../src/lib/material-purchase';
import {
  materialCreateSchema,
  materialBatchEntrySchema,
  materialBatchEntryUpdateSchema,
} from '../../src/lib/validation';

export function purchaseTestValues(): MaterialValues {
  return {
    name: '测试物料',
    categoryId: 'clx1234567890123456789012',
    unit: 'BEAD',
    purchaseUnitPrice: null,
    weightGrams: null,
    purchaseGramPrice: null,
    purchaseGramManual: false,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    childCount: null,
    childWeightGrams: null,
    childUnitPrice: null,
    childPriceSource: null,
    saleRule: 'PERCENT_10',
    saleRuleValue: null,
    saleUnitPrice: null,
    saleGramPrice: null,
    saleChildUnitPrice: null,
    saleUnitManual: false,
    saleGramManual: false,
    saleChildManual: false,
    notes: '',
  };
}
const batch = () => ({
  ...emptyPurchase(),
  mode: 'BATCH' as const,
  totalWeightGrams: '250.00',
  totalAmount: '2000.00',
});
const payload = () => ({
  values: { ...purchaseTestValues(), imageKeys: [] },
  distributorId: 'clx1234567890123456789012',
  receivedQty: null as number | null,
  selection: { batchId: 'clx1234567890123456789012' },
  purchase: batch(),
});

describe('batch purchase calculation', () => {
  it.each(['BEAD', 'STRAND'] as const)(
    'calculates average %s values and sale suggestions',
    (unit) => {
      const result = calculatePurchase(
        {
          ...purchaseTestValues(),
          unit,
          childCount: unit === 'STRAND' ? 10 : null,
          childPriceSource: unit === 'STRAND' ? 'COUNT' : null,
        },
        batch(),
        10,
      );
      expect(result.values).toMatchObject({
        purchaseUnitPrice: '200.00',
        weightGrams: '25.00',
        purchaseGramPrice: '8.00',
        saleUnitPrice: '220.00',
        saleGramPrice: '8.80',
      });
      expect(result.source).toBe('AVERAGE');
      if (unit === 'STRAND') expect(result.values.childUnitPrice).toBe('20.00');
    },
  );
  it('calculates any missing total from the other two', () => {
    expect(resolvePurchase(batch())).toMatchObject({
      quotedGramPrice: '8.00',
      autoField: 'quotedGramPrice',
    });
    expect(
      resolvePurchase({ ...batch(), totalAmount: null, quotedGramPrice: '8.00' }).totalAmount,
    ).toBe('2000.00');
    expect(
      resolvePurchase({ ...batch(), totalWeightGrams: null, quotedGramPrice: '8.00' })
        .totalWeightGrams,
    ).toBe('250.00');
  });
  it('updates only automatic totals and lets an explicit override become manual', () => {
    const automatic = resolvePurchase(batch());
    expect(editPurchase(automatic, 'totalAmount', '1950.00').quotedGramPrice).toBe('7.80');
    const manual = editPurchase(automatic, 'quotedGramPrice', '9.00');
    expect(manual.autoField).toBeNull();
    expect(editPurchase(manual, 'totalAmount', '1950.00').quotedGramPrice).toBe('9.00');
    expect(editPurchase(automatic, 'totalWeightGrams', null).quotedGramPrice).toBeNull();
  });
  it('preserves a quoted price and uses the actual amount for cost', () => {
    const result = calculatePurchase(
      purchaseTestValues(),
      { ...batch(), quotedGramPrice: '8.00', totalAmount: '1950.00' },
      10,
    );
    expect(result).toMatchObject({
      difference: '-50.00',
      purchase: { quotedGramPrice: '8.00' },
      values: { purchaseGramPrice: '7.80', purchaseUnitPrice: '195.00' },
    });
  });
  it('keeps unknown unit values empty, without deriving quantity', () => {
    const result = calculatePurchase(purchaseTestValues(), batch(), null);
    expect(result.values).toMatchObject({
      purchaseUnitPrice: null,
      weightGrams: null,
      purchaseGramPrice: '8.00',
    });
    expect(result.source).toBe('UNKNOWN');
  });
  it('estimates sample cost with unrounded actual cost, then uses a supplied count', () => {
    const purchase = {
      ...batch(),
      totalWeightGrams: '3.00',
      totalAmount: '1.00',
      sampleWeightGrams: '1.50',
    };
    expect(calculatePurchase(purchaseTestValues(), purchase, null)).toMatchObject({
      source: 'ESTIMATED',
      values: { weightGrams: '1.50', purchaseUnitPrice: '0.50' },
    });
    expect(calculatePurchase(purchaseTestValues(), purchase, 3)).toMatchObject({
      source: 'AVERAGE',
      values: { weightGrams: '1.00', purchaseUnitPrice: '0.33' },
      purchase: { sampleWeightGrams: '1.50' },
    });
  });
  it('retains manual purchase and sale overrides when totals or count change', () => {
    const values = { ...purchaseTestValues(), saleUnitManual: true, saleUnitPrice: '99.00' };
    const purchase = { ...batch(), sampleWeightGrams: '0.50', manualUnitPrice: '6.00' };
    expect(calculatePurchase(values, purchase, null)).toMatchObject({
      source: 'MANUAL',
      values: { purchaseUnitPrice: '6.00', saleUnitPrice: '99.00' },
    });
    expect(calculatePurchase(values, purchase, 500).values.purchaseUnitPrice).toBe('6.00');
    expect(
      calculatePurchase(values, { ...purchase, manualUnitPrice: null }, 500).values
        .purchaseUnitPrice,
    ).toBe('4.00');
  });
  it('does not round a sub-cent weight or cost upward into a stored measurement', () => {
    const result = calculatePurchase(
      purchaseTestValues(),
      { ...batch(), totalWeightGrams: '0.01', totalAmount: '0.01' },
      2,
    );
    expect(result).toMatchObject({
      belowPrecision: true,
      values: { weightGrams: null, purchaseUnitPrice: null },
    });
  });
  it('does not turn a positive calculated total into a free purchase', () => {
    expect(
      calculatePurchase(
        purchaseTestValues(),
        { ...batch(), totalAmount: null, quotedGramPrice: '0.01', totalWeightGrams: '0.01' },
        null,
      ),
    ).toMatchObject({ valid: false, belowPrecision: true });
    expect(
      calculatePurchase(
        purchaseTestValues(),
        { ...batch(), totalAmount: '0.01', totalWeightGrams: '250.00' },
        null,
      ),
    ).toMatchObject({
      valid: true,
      belowPrecision: true,
      purchase: { quotedGramPrice: null },
      values: { purchaseGramPrice: null },
    });
  });
  it('rejects an estimate exceeding the storage range', () => {
    expect(
      calculatePurchase(
        purchaseTestValues(),
        {
          ...batch(),
          totalWeightGrams: '0.01',
          totalAmount: '9999999999.99',
          sampleWeightGrams: '9999999999.99',
        },
        null,
      ).valid,
    ).toBe(false);
  });
  it('accepts free purchases only with a positive weight and does not divide by zero', () => {
    expect(
      calculatePurchase(purchaseTestValues(), { ...batch(), totalAmount: '0.00' }, 10).values
        .purchaseUnitPrice,
    ).toBe('0.00');
    expect(
      calculatePurchase(purchaseTestValues(), { ...batch(), totalWeightGrams: '0.00' }, null).valid,
    ).toBe(false);
    expect(
      calculatePurchase(
        purchaseTestValues(),
        { ...batch(), totalWeightGrams: null, quotedGramPrice: '0.00' },
        null,
      ).valid,
    ).toBe(false);
  });
  it('leaves positive results below precision empty and rejects overflowing totals', () => {
    const result = calculatePurchase(
      purchaseTestValues(),
      { ...batch(), totalWeightGrams: '0.01', totalAmount: '0.01' },
      100,
    );
    expect(result).toMatchObject({
      belowPrecision: true,
      values: { weightGrams: null, purchaseUnitPrice: null },
    });
    expect(
      calculatePurchase(
        purchaseTestValues(),
        {
          ...batch(),
          totalAmount: null,
          quotedGramPrice: '9999999999.99',
          totalWeightGrams: '9999999999.99',
        },
        null,
      ).valid,
    ).toBe(false);
  });
});

describe('purchase request compatibility and validation', () => {
  it('defaults old requests to unit mode with no invented batch totals', () => {
    const { purchase: _purchase, ...legacy } = payload();
    void _purchase;
    expect(materialCreateSchema.parse({ ...legacy, receivedQty: 10 }).purchase).toEqual(
      emptyPurchase(),
    );
    expect(materialCreateSchema.safeParse(legacy).success).toBe(false);
  });
  it('accepts unknown batch quantities on create, append, and edit', () => {
    expect(materialCreateSchema.safeParse(payload()).success).toBe(true);
    expect(materialBatchEntrySchema.safeParse(payload()).success).toBe(true);
    const { selection: _selection, ...edit } = payload();
    void _selection;
    expect(materialBatchEntryUpdateSchema.safeParse(edit).success).toBe(true);
  });
  it('rejects zero/negative/fractional counts, missing totals, and invalid samples', () => {
    for (const receivedQty of [0, -1, 1.5])
      expect(materialCreateSchema.safeParse({ ...payload(), receivedQty }).success).toBe(false);
    for (const purchase of [
      { ...batch(), totalAmount: null },
      { ...batch(), sampleWeightGrams: '0' },
      { ...batch(), manualUnitPrice: '-1.00' },
    ])
      expect(materialCreateSchema.safeParse({ ...payload(), purchase }).success).toBe(false);
  });
});
