import type { MaterialAmount, MaterialValues } from './client-types';
import { recalculateMaterial } from './material-calculations';

export type PurchaseTotalField = 'quotedGramPrice' | 'totalWeightGrams' | 'totalAmount';
export type MaterialPurchase = {
  mode: 'UNIT' | 'BATCH';
  quotedGramPrice: MaterialAmount;
  totalWeightGrams: MaterialAmount;
  totalAmount: MaterialAmount;
  autoField: PurchaseTotalField | null;
  sampleWeightGrams: MaterialAmount;
  manualUnitPrice: MaterialAmount;
  unitInputs: {
    price: MaterialAmount;
    weight: MaterialAmount;
    gramPrice: MaterialAmount;
    gramManual: boolean;
  } | null;
};
export const emptyPurchase = (): MaterialPurchase => ({
  mode: 'UNIT',
  quotedGramPrice: null,
  totalWeightGrams: null,
  totalAmount: null,
  autoField: null,
  sampleWeightGrams: null,
  manualUnitPrice: null,
  unitInputs: null,
});

function minor(value: MaterialAmount) {
  if (value === null || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}
function fixed(value: bigint) {
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}
function divide(numerator: bigint, denominator: bigint) {
  return denominator > BigInt(0)
    ? fixed((numerator + denominator / BigInt(2)) / denominator)
    : null;
}
const totalFields: PurchaseTotalField[] = ['quotedGramPrice', 'totalWeightGrams', 'totalAmount'];

export function resolvePurchase(input: MaterialPurchase) {
  const next = { ...input };
  const missing = totalFields.filter((field) => next[field] === null);
  const target = next.autoField ?? (missing.length === 1 ? missing[0] : null);
  if (target) {
    next.autoField = target;
    const price = minor(next.quotedGramPrice);
    const weight = minor(next.totalWeightGrams);
    const amount = minor(next.totalAmount);
    if (target === 'totalAmount')
      next.totalAmount =
        price !== null && weight !== null ? divide(price * weight, BigInt(100)) : null;
    if (target === 'totalWeightGrams')
      next.totalWeightGrams =
        amount !== null && price !== null ? divide(amount * BigInt(100), price) : null;
    if (target === 'quotedGramPrice')
      next.quotedGramPrice =
        amount !== null && weight !== null ? divide(amount * BigInt(100), weight) : null;
  }
  return next;
}

export function editPurchase(
  input: MaterialPurchase,
  field: PurchaseTotalField,
  value: MaterialAmount,
) {
  return resolvePurchase({
    ...input,
    [field]: value,
    autoField: input.autoField === field ? null : input.autoField,
  });
}

export function calculatePurchase(
  values: MaterialValues,
  input: MaterialPurchase,
  quantity: number | null,
) {
  const purchase = resolvePurchase(input);
  let source: 'UNIT' | 'AVERAGE' | 'ESTIMATED' | 'MANUAL' | 'UNKNOWN' = 'UNIT';
  let belowPrecision = false;
  let difference: MaterialAmount = null;
  let valid = true;
  let next = values;
  if (purchase.mode === 'BATCH') {
    const weight = minor(purchase.totalWeightGrams);
    const amount = minor(purchase.totalAmount);
    let quote = minor(purchase.quotedGramPrice);
    valid =
      weight !== null &&
      weight > BigInt(0) &&
      amount !== null &&
      totalFields.every((field) => purchase[field] === null || minor(purchase[field]) !== null);
    if (
      purchase.autoField === 'totalWeightGrams' &&
      amount !== null &&
      amount > BigInt(0) &&
      quote !== null &&
      amount * BigInt(100) < quote
    ) {
      valid = false;
      belowPrecision = true;
    }
    if (
      purchase.autoField === 'totalAmount' &&
      quote !== null &&
      weight !== null &&
      quote > BigInt(0) &&
      weight > BigInt(0) &&
      quote * weight < BigInt(100)
    ) {
      valid = false;
      belowPrecision = true;
    }
    if (
      purchase.autoField === 'quotedGramPrice' &&
      amount !== null &&
      amount > BigInt(0) &&
      weight !== null &&
      amount * BigInt(100) < weight
    ) {
      purchase.quotedGramPrice = null;
      quote = null;
      belowPrecision = true;
    }
    let gram = valid ? divide(amount! * BigInt(100), weight!) : null;
    const sample = minor(purchase.sampleWeightGrams);
    const knownQuantity = quantity !== null && Number.isInteger(quantity) && quantity > 0;
    let unitWeight =
      valid && knownQuantity ? divide(weight!, BigInt(quantity!)) : purchase.sampleWeightGrams;
    let unitPrice =
      valid && knownQuantity
        ? divide(amount!, BigInt(quantity!))
        : valid && sample !== null && sample > BigInt(0)
          ? divide(amount! * sample, weight!)
          : null;
    source = knownQuantity ? 'AVERAGE' : unitPrice !== null ? 'ESTIMATED' : 'UNKNOWN';
    if (purchase.manualUnitPrice !== null) {
      unitPrice =
        minor(purchase.manualUnitPrice) !== null ? fixed(minor(purchase.manualUnitPrice)!) : null;
      source = 'MANUAL';
    }
    if (unitWeight !== null && minor(unitWeight) !== null) unitWeight = fixed(minor(unitWeight)!);
    if (
      unitWeight !== null &&
      (minor(unitWeight) === BigInt(0) || (valid && knownQuantity && weight! < BigInt(quantity!)))
    ) {
      unitWeight = null;
      belowPrecision = true;
    }
    if (valid && amount! > BigInt(0)) {
      if (amount! * BigInt(100) < weight!) {
        gram = null;
        belowPrecision = true;
      }
      if (
        unitPrice !== null &&
        purchase.manualUnitPrice === null &&
        (knownQuantity
          ? amount! < BigInt(quantity!)
          : sample !== null && amount! * sample < weight!)
      ) {
        unitPrice = null;
        belowPrecision = true;
      }
    }
    if (valid && quote !== null) {
      const expected = (quote * weight! + BigInt(50)) / BigInt(100);
      const delta = amount! - expected;
      difference = `${delta < BigInt(0) ? '-' : ''}${fixed(delta < BigInt(0) ? -delta : delta)}`;
    }
    next = {
      ...values,
      purchaseUnitPrice: unitPrice,
      weightGrams: unitWeight,
      purchaseGramPrice: gram,
      purchaseGramManual: true,
    };
  }
  const calculated = recalculateMaterial(next);
  if (
    purchase.mode === 'BATCH' &&
    [
      calculated.purchaseUnitPrice,
      calculated.purchaseGramPrice,
      calculated.weightGrams,
      calculated.childUnitPrice,
      calculated.saleUnitPrice,
      calculated.saleGramPrice,
      calculated.saleChildUnitPrice,
    ].some((value) => value !== null && minor(value) === null)
  )
    valid = false;
  return { purchase, values: calculated, source, belowPrecision, difference, valid };
}
