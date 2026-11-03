import { calculatePurchase, editPurchase, resolvePurchase } from '@/lib/material-purchase';
import { editMaterial } from '@/lib/material-calculations';
import type { ImportItemData } from './contracts';
import { importMaterialDraft, importQuantity } from './materialDraft';

export type RecognitionField = 'ranges' | 'evidence' | 'price';

export function applyRecognitionPreview(
  item: ImportItemData,
  result: ImportItemData,
  fields: RecognitionField[],
): ImportItemData {
  // Materialize legacy drafts before changing evidence so it cannot implicitly replace prices.
  let material = importMaterialDraft(item);
  if (fields.includes('price') && result.price !== null) {
    const values = calculatePurchase(
      material.values,
      material.purchase,
      importQuantity(item),
    ).values;
    if (item.priceKind === 'SALE') {
      material = {
        ...material,
        values: editMaterial(
          values,
          values.unit === 'GRAM' ? 'saleGramPrice' : 'saleUnitPrice',
          result.price,
        ),
      };
    } else if (values.unit === 'GRAM') {
      const purchase = resolvePurchase(material.purchase);
      material = {
        ...material,
        // A corrected quote must never reinterpret the purchased quantity.
        purchase: editPurchase(
          {
            ...purchase,
            autoField: purchase.autoField === 'totalWeightGrams' ? null : purchase.autoField,
          },
          'quotedGramPrice',
          result.price,
        ),
      };
    } else if (material.purchase.mode === 'BATCH') {
      material = { ...material, purchase: { ...material.purchase, manualUnitPrice: result.price } };
    } else {
      material = { ...material, values: editMaterial(values, 'purchaseUnitPrice', result.price) };
    }
  }
  return {
    ...item,
    ...(fields.includes('ranges')
      ? { objectBox: result.objectBox, priceBox: result.priceBox }
      : {}),
    ...(fields.includes('evidence')
      ? { priceText: result.priceText, price: result.price, warnings: result.warnings }
      : {}),
    material,
    reviewed: false,
  };
}
