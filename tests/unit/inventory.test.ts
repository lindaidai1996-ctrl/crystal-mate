import { describe, expect, it } from 'vitest';
import {
  correctedRemainingQuantity,
  materialStockSummary,
  MAX_STOCK,
} from '../../src/lib/inventory';
import { productStockAdjustmentSchema, stockCountSchema } from '../../src/lib/validation';

describe('inventory counts', () => {
  it('separates unknown stock from zero and aggregates every batch', () => {
    expect(
      materialStockSummary([{ remainingQty: 20 }, { remainingQty: 0 }, { remainingQty: null }]),
    ).toEqual({ knownStock: 20, unknownStockBatchCount: 1 });
    expect(materialStockSummary([])).toEqual({ knownStock: 0, unknownStockBatchCount: 0 });
  });

  it.each([
    [10, 7, 12, 9],
    [10, 7, 10, 7],
    [null, null, 10, 10],
    [null, 7, 10, 7],
    [10, 7, null, 7],
    [null, null, null, null],
    [10, 7, 2, -1],
  ])(
    'corrects received %s / remaining %s to received %s => %s',
    (oldReceived, remainingQty, receivedQty, expected) => {
      expect(
        correctedRemainingQuantity({ receivedQty: oldReceived, remainingQty }, receivedQty),
      ).toBe(expected);
    },
  );

  it('validates actual counts, unknown snapshots and legacy product adjustments', () => {
    expect(stockCountSchema.parse({ quantity: 0, expectedQuantity: null })).toEqual({
      quantity: 0,
      expectedQuantity: null,
      reason: '',
    });
    expect(
      productStockAdjustmentSchema.safeParse({ quantity: 7, expectedQuantity: 10 }).success,
    ).toBe(true);
    expect(productStockAdjustmentSchema.safeParse({ delta: -3, reason: 'sale' }).success).toBe(
      true,
    );
    expect(
      productStockAdjustmentSchema.safeParse({ quantity: 7, expectedQuantity: null }).success,
    ).toBe(false);
    for (const quantity of [-1, 1.5, MAX_STOCK + 1]) {
      expect(stockCountSchema.safeParse({ quantity, expectedQuantity: 0 }).success).toBe(false);
    }
    expect(stockCountSchema.safeParse({ quantity: 7 }).success).toBe(false);
  });
});
