import { materialBatchHeaderSchema } from '@/lib/validation';
import type { ImportSettings } from './contracts';

const fieldCodes = {
  name: 'name',
  aliases: 'aliases',
  categoryId: 'category',
  unit: 'unit',
  quantity: 'quantity',
  receivedQty: 'quantity',
  purchaseUnitPrice: 'purchasePrice',
  purchaseGramPrice: 'purchasePrice',
  purchasePrice: 'purchasePrice',
  manualUnitPrice: 'purchasePrice',
  quotedGramPrice: 'quotedGramPrice',
  totalWeightGrams: 'totalWeight',
  totalAmount: 'totalAmount',
  weightGrams: 'weight',
  sampleWeightGrams: 'weight',
  lengthMm: 'dimensions',
  widthMm: 'dimensions',
  heightMm: 'dimensions',
  childCount: 'strand',
  childWeightGrams: 'strand',
  childUnitPrice: 'strand',
  childPriceSource: 'strand',
  saleRule: 'saleRule',
  saleRuleValue: 'saleRule',
  saleUnitPrice: 'salePrice',
  saleGramPrice: 'salePrice',
  saleChildUnitPrice: 'salePrice',
  salePrice: 'salePrice',
  notes: 'notes',
  tagIds: 'tags',
  imageKeys: 'images',
  images: 'images',
  objectBox: 'crop',
  priceBox: 'crop',
  price: 'recognition',
  priceText: 'recognition',
  warnings: 'recognition',
  priceKind: 'recognition',
  existingMaterialId: 'existingMaterial',
} as const;

export type ImportIssueCode =
  | (typeof fieldCodes)[keyof typeof fieldCodes]
  | 'reviewed'
  | 'selected'
  | 'purchase'
  | 'draft'
  | 'supplier'
  | 'batch'
  | 'batchName'
  | 'batchDate'
  | 'batchNotes';

export type ImportValidationIssue = { scope: 'item' | 'settings'; code: ImportIssueCode };

export function importValidationIssues(
  issues: { path: PropertyKey[] }[],
  settings: ImportSettings,
): ImportValidationIssue[] {
  return issues.flatMap((issue): ImportValidationIssue[] => {
    if (issue.path[0] === 'distributorId') return [{ scope: 'settings', code: 'supplier' }];
    if (issue.path[0] === 'selection') {
      if (settings.selection && 'newBatch' in settings.selection) {
        const parsed = materialBatchHeaderSchema.safeParse(settings.selection.newBatch);
        if (!parsed.success)
          return parsed.error.issues.map((entry) => ({
            scope: 'settings',
            code:
              entry.path[0] === 'name'
                ? 'batchName'
                : entry.path[0] === 'receivedAt'
                  ? 'batchDate'
                  : 'batchNotes',
          }));
      }
      return [{ scope: 'settings', code: 'batch' }];
    }
    for (const part of issue.path) {
      if (typeof part === 'string' && Object.hasOwn(fieldCodes, part))
        return [{ scope: 'item', code: fieldCodes[part as keyof typeof fieldCodes] }];
    }
    return [{ scope: 'item', code: issue.path.includes('purchase') ? 'purchase' : 'draft' }];
  });
}

export function uniqueImportIssues(issues: ImportValidationIssue[]) {
  return issues.filter(
    (issue, index) =>
      issues.findIndex((other) => other.scope === issue.scope && other.code === issue.code) ===
      index,
  );
}
