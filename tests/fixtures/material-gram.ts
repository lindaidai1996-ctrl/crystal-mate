import type { MaterialValues } from '../../src/lib/client-types';
import { emptyPurchase } from '../../src/lib/material-purchase';

export const gramValues = (): MaterialValues => ({
  name: '银料',
  categoryId: 'clx1234567890123456789012',
  unit: 'GRAM',
  purchaseUnitPrice: null,
  purchaseGramPrice: null,
  weightGrams: null,
  purchaseGramManual: false,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  childCount: null,
  childWeightGrams: null,
  childUnitPrice: null,
  childPriceSource: null,
  saleRule: 'PERCENT_50',
  saleRuleValue: null,
  saleUnitPrice: null,
  saleGramPrice: null,
  saleChildUnitPrice: null,
  saleUnitManual: false,
  saleGramManual: false,
  saleChildManual: false,
  notes: '',
});
export const gramPurchase = () => ({
  ...emptyPurchase(),
  mode: 'BATCH' as const,
  totalWeightGrams: '100.00',
  totalAmount: '800.00',
});
export const gramPayload = () => ({
  values: { ...gramValues(), imageKeys: [] },
  purchase: gramPurchase(),
  receivedQty: 100,
  selection: { batchId: gramValues().categoryId },
  distributorId: gramValues().categoryId,
});
