import type { MaterialValues } from './client-types';

export function emptyMaterial(): MaterialValues {
  return {
    name: '',
    aliases: [],
    categoryId: '',
    unit: 'STRAND',
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
    saleRule: 'PERCENT_60',
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
