import {
  gramValues as values,
  gramPurchase as purchase,
  gramPayload as payload,
} from '../fixtures/material-gram';
import { describe, expect, it } from 'vitest';
import { recalculateMaterial, editMaterial } from '../../src/lib/material-calculations';
import { calculatePurchase, editPurchase, emptyPurchase } from '../../src/lib/material-purchase';
import {
  correctedRemainingQuantity,
  materialStockSummary,
  validMaterialQuantity,
} from '../../src/lib/inventory';
import { materialCreateSchema, materialBatchEntryUpdateSchema } from '../../src/lib/validation';
import { calculateDiyCost, calculateDiyQuote } from '../../src/lib/product-diy-cost';

describe('gram materials', () => {
  it('calculates costs and sale prices per gram for fractional stock', () => {
    const result = calculatePurchase(
      values(),
      { ...purchase(), totalWeightGrams: '2.50', totalAmount: '20.00' },
      2.5,
    );
    expect(result).toMatchObject({
      valid: true,
      values: {
        weightGrams: '1.00',
        purchaseGramPrice: '8.00',
        purchaseUnitPrice: '8.00',
        saleGramPrice: '12.00',
        saleUnitPrice: '12.00',
      },
    });
    expect(
      calculatePurchase(
        values(),
        { ...purchase(), manualUnitPrice: '999', sampleWeightGrams: '2' },
        100,
      ).values.purchaseUnitPrice,
    ).toBe('8.00');
  });

  it('calculates any missing purchase total, including received weight', () => {
    const priceAndAmount = { ...purchase(), quotedGramPrice: '8.00', totalWeightGrams: null };
    const calculated = calculatePurchase(values(), priceAndAmount, 100);
    expect(calculated.purchase.totalWeightGrams).toBe('100.00');
    expect(calculated.valid).toBe(true);
    const updated = editPurchase(calculated.purchase, 'totalAmount', '804.00');
    expect(updated.totalWeightGrams).toBe('100.50');
    expect(
      calculatePurchase(
        values(),
        { ...purchase(), quotedGramPrice: '8.00', totalAmount: null },
        100,
      ).purchase.totalAmount,
    ).toBe('800.00');
    expect(calculatePurchase(values(), purchase(), 100).purchase.quotedGramPrice).toBe('8.00');
  });

  it('applies fixed markup per gram and preserves manual and custom gram prices', () => {
    const cost = calculatePurchase(values(), purchase(), 100).values;
    const fixed = recalculateMaterial(
      { ...cost, saleRule: 'FIXED_AMOUNT', saleRuleValue: '2.00' },
      true,
    );
    expect(fixed.saleGramPrice).toBe('10.00');
    expect(fixed.saleUnitPrice).toBe('10.00');
    const manual = editMaterial(fixed, 'saleGramPrice', '15.00');
    expect(
      calculatePurchase(manual, { ...purchase(), totalAmount: '900' }, 100).values.saleGramPrice,
    ).toBe('15.00');
    const custom = recalculateMaterial({
      ...manual,
      saleRule: 'CUSTOM_AMOUNT',
      saleRuleValue: null,
    });
    expect(custom.saleGramPrice).toBe('15.00');
    expect(custom.saleUnitPrice).toBe('15.00');
    expect(editMaterial(custom, 'saleGramPrice', null).saleUnitPrice).toBeNull();
  });

  it('requires a known weight matching stock and keeps strand and bead quantities integral', () => {
    expect(materialCreateSchema.safeParse(payload()).success).toBe(true);
    expect(
      materialCreateSchema.safeParse({
        ...payload(),
        receivedQty: 2.5,
        purchase: { ...purchase(), totalWeightGrams: '2.50', totalAmount: '20.00' },
      }).success,
    ).toBe(true);
    for (const change of [
      { receivedQty: null },
      { receivedQty: 99 },
      { receivedQty: 0 },
      { purchase: { ...purchase(), totalWeightGrams: null, quotedGramPrice: null } },
      { purchase: emptyPurchase() },
      { receivedQty: 1.001 },
    ])
      expect(materialCreateSchema.safeParse({ ...payload(), ...change }).success).toBe(false);
    for (const unit of ['STRAND', 'BEAD'] as const) {
      expect(
        materialCreateSchema.safeParse({
          ...payload(),
          values: { ...payload().values, unit },
          receivedQty: 2.5,
        }).success,
      ).toBe(false);
    }
    const { selection: _selection, ...update } = payload();
    void _selection;
    expect(materialBatchEntryUpdateSchema.safeParse(update).success).toBe(true);
  });

  it('sums and corrects fractional stock without floating point remnants', () => {
    expect(
      materialStockSummary([{ remainingQty: 0.1 }, { remainingQty: 0.2 }, { remainingQty: null }]),
    ).toEqual({ knownStock: 0.3, unknownStockBatchCount: 1 });
    expect(correctedRemainingQuantity({ receivedQty: 0.2, remainingQty: 0.1 }, 0.3)).toBe(0.2);
    expect(validMaterialQuantity(2.5, 'GRAM')).toBe(true);
    expect(validMaterialQuantity(2.5, 'BEAD')).toBe(false);
    expect(validMaterialQuantity(2.555, 'GRAM')).toBe(false);
  });

  it('uses 2.5 grams at 8 cost and 12 sale price for DIY cost and quote', () => {
    const input = {
      origin: 'DIY' as const,
      notes: '',
      quantity: 1,
      materials: [
        {
          materialBatchEntryId: values().categoryId,
          usageUnit: 'GRAM' as const,
          quantity: '2.50',
          unitCost: '8.00',
          quoteUnitPrice: '12.00',
        },
      ],
      cabochons: [],
      extraCosts: [],
    };
    expect(calculateDiyCost(input)).toMatchObject({ perUnitCost: '20.00', totalCost: '20.00' });
    expect(calculateDiyQuote(input)).toMatchObject({ perUnitQuote: '30.00', totalQuote: '30.00' });
  });
});
