import type {
  MaterialAmount,
  MaterialCategory,
  MaterialPriceSource,
  MaterialValues,
} from './client-types';

function minor(value: MaterialAmount): bigint | null {
  if (value === null || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}

function fixed(value: bigint): string {
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}

function divide(numerator: bigint, denominator: bigint): string | null {
  return denominator > BigInt(0)
    ? fixed((numerator + denominator / BigInt(2)) / denominator)
    : null;
}

export function purchaseCandidates(values: MaterialValues) {
  const price = minor(values.purchaseUnitPrice);
  const weight = minor(values.weightGrams);
  const childWeight = minor(values.childWeightGrams);
  return {
    gram: price !== null && weight !== null ? divide(price * BigInt(100), weight) : null,
    count:
      values.unit === 'STRAND' && price !== null && values.childCount !== null
        ? divide(price, BigInt(values.childCount))
        : null,
    weight:
      values.unit === 'STRAND' && price !== null && weight !== null && childWeight !== null
        ? divide(price * childWeight, weight)
        : null,
  };
}

function salePrice(cost: MaterialAmount, values: MaterialValues, isUnit = false): string | null {
  const amount = minor(cost);
  if (amount === null) return null;
  const percentages = {
    COST: BigInt(0),
    PERCENT_10: BigInt(1000),
    PERCENT_20: BigInt(2000),
    PERCENT_30: BigInt(3000),
    PERCENT_50: BigInt(5000),
  } as const;
  if (values.saleRule === 'FIXED_AMOUNT') {
    const addition = minor(values.saleRuleValue);
    const unitCost = minor(values.purchaseUnitPrice);
    if (addition === null || unitCost === null) return null;
    if (isUnit) return fixed(amount + addition);
    return unitCost > BigInt(0) ? divide(amount * (unitCost + addition), unitCost) : null;
  }
  const percentage =
    values.saleRule === 'CUSTOM_PERCENT'
      ? minor(values.saleRuleValue)
      : percentages[values.saleRule];
  return percentage !== null ? divide(amount * (BigInt(10000) + percentage), BigInt(10000)) : null;
}

export function recalculateMaterial(values: MaterialValues, resetSales = false): MaterialValues {
  const next = { ...values };
  if (next.unit === 'BEAD') {
    next.childCount = null;
    next.childWeightGrams = null;
    next.childUnitPrice = null;
    next.childPriceSource = null;
    next.saleChildUnitPrice = null;
    next.saleChildManual = false;
  }
  const candidates = purchaseCandidates(next);
  if (!next.purchaseGramManual) next.purchaseGramPrice = candidates.gram;
  if (next.childPriceSource === 'COUNT') next.childUnitPrice = candidates.count;
  if (next.childPriceSource === 'WEIGHT') next.childUnitPrice = candidates.weight;
  if (resetSales || !next.saleUnitManual)
    next.saleUnitPrice = salePrice(next.purchaseUnitPrice, next, true);
  if (resetSales || !next.saleGramManual)
    next.saleGramPrice = salePrice(next.purchaseGramPrice, next);
  if (next.unit === 'STRAND' && (resetSales || !next.saleChildManual))
    next.saleChildUnitPrice = salePrice(next.childUnitPrice, next);
  if (resetSales) {
    next.saleUnitManual = false;
    next.saleGramManual = false;
    next.saleChildManual = false;
  }
  return next;
}

export function editMaterial(
  current: MaterialValues,
  field: keyof MaterialValues,
  value: string | number | null,
): MaterialValues {
  const next = { ...current, [field]: value } as MaterialValues;
  if (field === 'purchaseGramPrice') next.purchaseGramManual = value !== null;
  if (field === 'saleUnitPrice') next.saleUnitManual = value !== null;
  if (field === 'saleGramPrice') next.saleGramManual = value !== null;
  if (field === 'saleChildUnitPrice') next.saleChildManual = value !== null;
  if (field === 'childUnitPrice') {
    const candidates = purchaseCandidates(next);
    const matches: MaterialPriceSource[] = [];
    if (
      value !== null &&
      candidates.count !== null &&
      minor(String(value)) === minor(candidates.count)
    )
      matches.push('COUNT');
    if (
      value !== null &&
      candidates.weight !== null &&
      minor(String(value)) === minor(candidates.weight)
    )
      matches.push('WEIGHT');
    next.childPriceSource =
      matches.find((candidate) => candidate === current.childPriceSource) ??
      matches[0] ??
      (value === null ? null : 'CUSTOM');
    if (next.childPriceSource === 'COUNT') next.childUnitPrice = candidates.count;
    if (next.childPriceSource === 'WEIGHT') next.childUnitPrice = candidates.weight;
  }
  return recalculateMaterial(next, field === 'saleRule' || field === 'saleRuleValue');
}

export function recognizeMaterialCategory(name: string, categories: MaterialCategory[]) {
  const input = name.trim().toLocaleLowerCase();
  if (!input) return null;
  const matches = categories.flatMap((category) => {
    const positions: Array<[number, number]> = [];
    let length = 0;
    for (const value of [category.name, ...category.aliases]) {
      const term = value.trim().toLocaleLowerCase();
      if (!term) continue;
      let start = input.indexOf(term);
      while (start !== -1) {
        positions.push([start, start + term.length]);
        length = Math.max(length, term.length);
        start = input.indexOf(term, start + 1);
      }
    }
    return length ? [{ category, length, positions }] : [];
  });
  const byId = new Map(matches.map((match) => [match.category.id, match]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const ranked = matches.map((match) => {
    let context = 0;
    let parentId = match.category.parentId;
    const visited = new Set([match.category.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (
        parent?.positions.some(([parentStart, parentEnd]) =>
          match.positions.some(([start, end]) => parentEnd <= start || end <= parentStart),
        )
      )
        context++;
      parentId = categoriesById.get(parentId)?.parentId ?? null;
    }
    return { ...match, context };
  });
  const bestContext = Math.max(0, ...ranked.map((match) => match.context));
  const contextual = ranked.filter((match) => match.context === bestContext);
  const bestLength = Math.max(0, ...contextual.map((match) => match.length));
  const winners = contextual.filter((match) => match.length === bestLength);
  return winners.length === 1 ? winners[0].category : null;
}
