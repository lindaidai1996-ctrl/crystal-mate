import { describe, expect, it } from 'vitest';
import type { MaterialValues } from '../../src/lib/client-types';
import { purchaseCandidates } from '../../src/lib/material-calculations';
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
  it('offers and adopts count pricing without weight, then recalculates after quantity changes', () => {
    const purchase = { ...emptyPurchase(), mode: 'BATCH' as const, totalAmount: '244.00' };
    const result = calculatePurchase(
      {
        ...purchaseTestValues(),
        unit: 'STRAND',
        childCount: 122,
        childWeightGrams: '1.00',
        purchaseUnitPrice: '999.00',
        weightGrams: '999.00',
        purchaseGramPrice: '999.00',
      },
      purchase,
      1,
    );
    expect(result.values).toMatchObject({
      purchaseUnitPrice: '244.00',
      weightGrams: null,
      purchaseGramPrice: null,
      childUnitPrice: null,
    });
    const candidates = purchaseCandidates(result.values);
    expect(candidates).toEqual({ count: '2.00', gram: null, weight: null });

    const adopted = calculatePurchase(
      { ...result.values, childPriceSource: 'COUNT', childUnitPrice: candidates.count },
      purchase,
      1,
    );
    expect(adopted.values.childUnitPrice).toBe('2.00');
    expect(calculatePurchase(adopted.values, purchase, 2)).toMatchObject({
      valid: true,
      values: { purchaseUnitPrice: '122.00', childUnitPrice: '1.00' },
    });
    const manual = calculatePurchase(adopted.values, { ...purchase, manualUnitPrice: '366.00' }, 1);
    expect(manual.values.childUnitPrice).toBe('3.00');
    expect(calculatePurchase(manual.values, purchase, 1)).toMatchObject({
      source: 'AVERAGE',
      values: { purchaseUnitPrice: '244.00', childUnitPrice: '2.00' },
    });
  });
  it.each([null, '68.00'])(
    'calculates cost and sale prices without a total weight (manual price: %s)',
    (manualUnitPrice) => {
      const result = calculatePurchase(
        {
          ...purchaseTestValues(),
          unit: 'STRAND',
          childCount: 122,
          childPriceSource: 'COUNT',
          saleRule: 'FIXED_AMOUNT',
          saleRuleValue: '298.00',
        },
        {
          ...emptyPurchase(),
          mode: 'BATCH',
          totalAmount: '68.00',
          manualUnitPrice,
        },
        1,
      );
      expect(result).toMatchObject({
        valid: true,
        source: manualUnitPrice === null ? 'AVERAGE' : 'MANUAL',
        difference: null,
        belowPrecision: false,
        values: {
          purchaseUnitPrice: '68.00',
          weightGrams: null,
          purchaseGramPrice: null,
          childUnitPrice: '0.56',
          saleUnitPrice: '366.00',
          saleGramPrice: null,
          saleChildUnitPrice: '3.01',
        },
      });
    },
  );
  it('divides the amount by quantity without requiring a weight', () => {
    expect(
      calculatePurchase(
        purchaseTestValues(),
        { ...emptyPurchase(), mode: 'BATCH', totalAmount: '68.00' },
        2,
      ),
    ).toMatchObject({ valid: true, values: { purchaseUnitPrice: '34.00', weightGrams: null } });
  });
  it('keeps cost unknown without a quantity or total weight, even with a sample weight', () => {
    expect(
      calculatePurchase(
        purchaseTestValues(),
        { ...emptyPurchase(), mode: 'BATCH', totalAmount: '68.00', sampleWeightGrams: '1.00' },
        null,
      ),
    ).toMatchObject({
      valid: true,
      source: 'UNKNOWN',
      values: { purchaseUnitPrice: null, weightGrams: '1.00', purchaseGramPrice: null },
    });
  });
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
  it('accepts free purchases and rejects zero weights or division by zero', () => {
    expect(
      calculatePurchase(
        purchaseTestValues(),
        { ...emptyPurchase(), mode: 'BATCH', totalAmount: '0.00' },
        10,
      ),
    ).toMatchObject({ valid: true, values: { purchaseUnitPrice: '0.00', weightGrams: null } });
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
  it.each([1, null])(
    'accepts an amount without weight on create, append, and edit (quantity: %s)',
    (receivedQty) => {
      const input = {
        ...payload(),
        receivedQty,
        purchase: { ...emptyPurchase(), mode: 'BATCH', totalAmount: '68.00' },
      };
      expect(materialCreateSchema.safeParse(input).success).toBe(true);
      expect(materialBatchEntrySchema.safeParse(input).success).toBe(true);
      const { selection: _selection, ...edit } = input;
      void _selection;
      expect(materialBatchEntryUpdateSchema.safeParse(edit).success).toBe(true);
    },
  );
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
