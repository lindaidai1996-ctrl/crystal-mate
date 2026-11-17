import type { Material, MaterialBatchEntry, ProductSourceInput } from '@/lib/client-types';
import { suggestedMaterialQuote } from '@/lib/product-diy-quote';
import type { PickerSelection } from './contracts';

type DiyDraft = Extract<ProductSourceInput, { origin: 'DIY' }>;
type UsageUnit = DiyDraft['materials'][number]['usageUnit'];
export function suggestedMaterialCost(
  option: { material: Material; entry: MaterialBatchEntry },
  unit: UsageUnit,
) {
  if (unit === 'GRAM') return option.entry.purchaseGramPrice;
  if (unit === 'STRAND' || option.material.unit === 'BEAD') return option.entry.purchaseUnitPrice;
  return option.entry.childUnitPrice;
}

export function preferredMaterialUsageUnit(
  option: { material: Material; entry: MaterialBatchEntry },
  preferred: UsageUnit = 'BEAD',
): UsageUnit {
  if (option.material.unit === 'GRAM') return 'GRAM';
  // Preserve the current unit when priced; zero is also a valid price.
  const candidates: UsageUnit[] = [preferred, 'BEAD', 'GRAM', 'STRAND'];
  return candidates.find((unit) => suggestedMaterialCost(option, unit) != null) ?? preferred;
}

export function applyPickerSelection(
  draft: DiyDraft,
  selections: PickerSelection[],
  replaceIndex?: number,
): DiyDraft {
  let result = draft;
  for (const selection of selections) {
    if (selection.kind === 'materials') {
      const previous = replaceIndex === undefined ? undefined : result.materials[replaceIndex];
      const usageUnit = preferredMaterialUsageUnit(selection, previous?.usageUnit);
      const line = {
        ...previous,
        materialBatchEntryId: selection.entry.id,
        usageUnit,
        quantity: previous?.quantity ?? '1',
        unitCost: suggestedMaterialCost(selection, usageUnit) ?? '',
        quoteUnitPrice: suggestedMaterialQuote(selection, usageUnit),
      };
      result = {
        ...result,
        materials:
          replaceIndex === undefined
            ? [...result.materials, line]
            : result.materials.map((item, index) => (index === replaceIndex ? line : item)),
      };
    } else {
      const previous = replaceIndex === undefined ? undefined : result.cabochons[replaceIndex];
      const line = {
        ...previous,
        productId: selection.product.id,
        quantity: previous?.quantity ?? 1,
        unitCost: selection.product.cost?.totalCost ?? '',
        quoteUnitPrice: (selection.product.priceCents / 100).toFixed(2),
      };
      result = {
        ...result,
        cabochons:
          replaceIndex === undefined
            ? [...result.cabochons, line]
            : result.cabochons.map((item, index) => (index === replaceIndex ? line : item)),
      };
    }
  }
  return result;
}
