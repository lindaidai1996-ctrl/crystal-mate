import { emptyMaterial } from '@/lib/material-defaults';
import { recalculateMaterial } from '@/lib/material-calculations';
import { emptyPurchase, resolvePurchase } from '@/lib/material-purchase';
import { effectivePrices, type ImportItemData, type ImportMaterialDraft } from './contracts';

// Old saved drafts keep their original values; new edits use the complete material form.
export function importMaterialDraft(item: ImportItemData): ImportMaterialDraft {
  if (item.material) return item.material;
  const prices = effectivePrices(item);
  const gram = item.unit === 'GRAM';
  return {
    values: recalculateMaterial({
      ...emptyMaterial(),
      name: item.name,
      categoryId: item.categoryId,
      unit: item.unit,
      purchaseUnitPrice: gram ? null : prices.purchase,
      purchaseGramPrice: gram ? prices.purchase : null,
      purchaseGramManual: gram,
      saleRule: prices.sale !== null ? 'CUSTOM_AMOUNT' : 'PERCENT_60',
      saleUnitPrice: gram ? null : prices.sale,
      saleGramPrice: gram ? prices.sale : null,
      saleUnitManual: !gram && prices.sale !== null,
      saleGramManual: gram && prices.sale !== null,
    }),
    purchase: gram
      ? resolvePurchase({
          ...emptyPurchase(),
          mode: 'BATCH',
          quotedGramPrice: prices.purchase,
          totalWeightGrams: item.quantity?.toFixed(2) ?? null,
          autoField: 'totalAmount',
        })
      : emptyPurchase(),
    quantityUnknown: false,
    tagIds: [],
    images: [],
  };
}

export function importQuantity(item: ImportItemData, material = importMaterialDraft(item)) {
  if (material.values.unit === 'GRAM') {
    const weight = resolvePurchase(material.purchase).totalWeightGrams;
    return weight === null ? null : Number(weight);
  }
  return material.quantityUnknown && material.purchase.mode === 'BATCH' ? null : item.quantity;
}

export function patchImportItem(
  item: ImportItemData,
  patch: Partial<ImportItemData>,
): ImportItemData {
  const next = { ...item, ...patch };
  if (!item.material || patch.material) return next;
  const material = { ...item.material, values: { ...item.material.values } };
  for (const field of ['name', 'categoryId', 'unit'] as const) {
    if (patch[field] !== undefined) Object.assign(material.values, { [field]: patch[field] });
  }
  if (patch.priceKind !== undefined && patch.priceKind !== item.priceKind) {
    const gram = material.values.unit === 'GRAM';
    const purchaseField = gram ? 'purchaseGramPrice' : 'purchaseUnitPrice';
    const saleField = gram ? 'saleGramPrice' : 'saleUnitPrice';
    material.values[purchaseField] =
      patch.priceKind === 'PURCHASE' ? item.price : item.purchasePrice;
    material.values[saleField] = patch.priceKind === 'SALE' ? item.price : item.salePrice;
    material.values.saleRule = material.values[saleField] !== null ? 'CUSTOM_AMOUNT' : 'PERCENT_60';
    material.values.saleRuleValue = null;
    material.values.saleUnitManual = !gram && material.values[saleField] !== null;
    material.values.saleGramManual = gram && material.values[saleField] !== null;
    if (gram)
      material.purchase = resolvePurchase({
        ...material.purchase,
        quotedGramPrice: material.values[purchaseField],
        totalAmount: null,
        autoField: 'totalAmount',
      });
    material.values = recalculateMaterial(material.values, material.values[saleField] === null);
  }
  return { ...next, material };
}
