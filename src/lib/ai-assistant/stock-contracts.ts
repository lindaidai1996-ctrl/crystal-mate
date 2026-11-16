import { z } from 'zod';
import {
  assistantQuerySchema,
  catalogRefSchema,
  entityRefSchema,
  purchaseRefSchema,
} from './contracts';
import { CANDIDATE_LIMIT } from './candidate-contracts';
import { purchaseDecimalSchema } from './purchase-contracts';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const unit = z.enum(['STRAND', 'BEAD', 'GRAM', 'PIECE']);
export const stockQuerySchema = z
  .strictObject({
    mode: z.enum(['catalog_current', 'purchase_remaining']),
    query: assistantQuerySchema,
    selectedItems: z.array(catalogRefSchema).max(CANDIDATE_LIMIT).optional(),
    selectedPurchases: z.array(purchaseRefSchema).max(CANDIDATE_LIMIT).optional(),
  })
  .superRefine((input, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (input.query.pagination.cursor) fail('Stock queries require a fresh observation, no cursor');
    if (input.query.subject === 'catalog' && input.selectedPurchases !== undefined)
      fail('Catalog query accepts only selectedItems');
    if (input.query.subject === 'purchases' && input.selectedItems !== undefined)
      fail('Purchase query accepts only selectedPurchases');
    if (
      input.mode === 'purchase_remaining' &&
      (input.query.subject !== 'purchases' ||
        input.query.itemTypes.some((type) => type !== 'MATERIAL'))
    )
      fail('Source remaining stock is available only for material purchases');
    const refs = input.selectedItems ?? input.selectedPurchases ?? [];
    if (new Set(refs.map((r) => `${r.type}:${r.id}`)).size !== refs.length)
      fail('Duplicate stock selection');
    for (const ref of refs) {
      const type =
        ref.type === 'MATERIAL_PURCHASE'
          ? 'MATERIAL'
          : ref.type === 'PRODUCT_PURCHASE'
            ? 'PRODUCT'
            : ref.type;
      if (!input.query.itemTypes.includes(type)) fail('Selected type outside stock query');
    }
  });
export const catalogStockSchema = z
  .strictObject({
    item: catalogRefSchema,
    name: z.string(),
    unit,
    knownStock: purchaseDecimalSchema,
    unknownStockBatchCount: count,
    stockBatchCount: count.nullable(),
  })
  .superRefine((row, ctx) => {
    if (
      row.item.type === 'PRODUCT'
        ? row.unit !== 'PIECE' || row.stockBatchCount !== null || row.unknownStockBatchCount !== 0
        : row.unit === 'PIECE' ||
          row.stockBatchCount === null ||
          row.unknownStockBatchCount > row.stockBatchCount
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent stock identity/unit/batches' });
  });
export const sourceStockSchema = z.strictObject({
  item: z.strictObject({ type: z.literal('MATERIAL'), id: entityRefSchema.shape.id }),
  purchase: z.strictObject({ type: z.literal('MATERIAL_PURCHASE'), id: entityRefSchema.shape.id }),
  batch: z.strictObject({ type: z.literal('BATCH'), id: entityRefSchema.shape.id }),
  name: z.string(),
  unit: z.enum(['STRAND', 'BEAD', 'GRAM']),
  purchasedQuantity: purchaseDecimalSchema.nullable(),
  remainingQuantity: purchaseDecimalSchema.nullable(),
});
export const stockResultSchema = z
  .strictObject({
    version: z.literal('v1'),
    queriedAt: z.iso.datetime({ offset: true }),
    request: stockQuerySchema,
    scopeCandidateCount: count,
    selectedCandidateCount: count,
    catalogItemCount: count,
    traversal: z.literal('complete'),
    semanticEvaluation: z.literal('not_performed'),
    catalogStock: z.array(catalogStockSchema).max(CANDIDATE_LIMIT),
    sourceStock: z.array(sourceStockSchema).max(CANDIDATE_LIMIT),
    quantities: z
      .array(
        z.strictObject({
          unit,
          knownStock: purchaseDecimalSchema,
          unknownStockObjectCount: count,
          unknownStockBatchCount: count,
        }),
      )
      .max(4),
  })
  .superRefine((result, ctx) => {
    const current = result.request.mode === 'catalog_current';
    const rows = current ? result.catalogStock : result.sourceStock;
    const catalogs = new Set(rows.map((r) => `${r.item.type}:${r.item.id}`));
    const keys = current
      ? result.catalogStock.map((r) => `${r.item.type}:${r.item.id}`)
      : result.sourceStock.map((r) => r.purchase.id);
    if (
      (current ? result.sourceStock.length : result.catalogStock.length) ||
      catalogs.size !== result.catalogItemCount ||
      new Set(keys).size !== rows.length ||
      result.selectedCandidateCount > result.scopeCandidateCount ||
      (current
        ? rows.length > result.selectedCandidateCount
        : rows.length !== result.selectedCandidateCount) ||
      new Set(result.quantities.map((r) => r.unit)).size !== result.quantities.length
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent stock result coverage' });
  });
export type StockQuery = z.infer<typeof stockQuerySchema>;
export type CatalogStock = z.infer<typeof catalogStockSchema>;
export type SourceStock = z.infer<typeof sourceStockSchema>;
export type StockResult = z.infer<typeof stockResultSchema>;
