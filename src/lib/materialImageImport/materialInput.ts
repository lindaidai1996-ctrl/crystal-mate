import { z } from 'zod';
import { materialCreateSchema } from '@/lib/validation';
import { validMaterialQuantity } from '@/lib/inventory';
import { calculatePurchase } from '@/lib/material-purchase';
import { importMaterialDraft, importQuantity } from './materialDraft';
import { importItemDataSchema, type ImportItemData, type ImportSettings } from './contracts';
import {
  importValidationIssues,
  uniqueImportIssues,
  type ImportValidationIssue,
} from './validationIssues';

export function materialInputFromImport(
  item: ImportItemData,
  settings: ImportSettings,
  imageKey: string,
): z.infer<typeof materialCreateSchema> | null {
  return validateMaterialImport(item, settings, imageKey).input;
}

export function validateMaterialImport(
  item: ImportItemData,
  settings: ImportSettings,
  imageKey: string,
): { input: z.infer<typeof materialCreateSchema> | null; issues: ImportValidationIssue[] } {
  const issues: ImportValidationIssue[] = [];
  if (!item.reviewed) issues.push({ scope: 'item', code: 'reviewed' });
  if (!item.selected) issues.push({ scope: 'item', code: 'selected' });
  const draft = importItemDataSchema.safeParse(item);
  // Invalid draft values cannot safely enter the price calculations.
  if (!draft.success)
    return {
      input: null,
      issues: uniqueImportIssues([
        ...issues,
        ...importValidationIssues(draft.error.issues, settings),
      ]),
    };
  if (!item.material && item.quantity !== null && !validMaterialQuantity(item.quantity, item.unit))
    issues.push({ scope: 'item', code: 'quantity' });
  const material = importMaterialDraft(item);
  const quantity = importQuantity(item, material);
  const calculated = calculatePurchase(material.values, material.purchase, quantity);
  // A recognized sale price must never silently become a purchase cost.
  if (calculated.purchase.mode === 'UNIT' && calculated.values.purchaseUnitPrice === null)
    issues.push({ scope: 'item', code: 'purchasePrice' });
  const result = materialCreateSchema.safeParse({
    values: {
      ...calculated.values,
      imageKeys: [imageKey, ...material.images.map((image) => image.objectKey)],
    },
    tagIds: material.tagIds,
    purchase: calculated.purchase,
    receivedQty: quantity,
    distributorId: settings.distributorId,
    selection: settings.selection,
  });
  if (!result.success) issues.push(...importValidationIssues(result.error.issues, settings));
  return {
    input: result.success && !issues.length ? result.data : null,
    issues: uniqueImportIssues(issues),
  };
}
