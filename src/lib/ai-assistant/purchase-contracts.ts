import { z } from 'zod';
import {
  assistantQuerySchema,
  catalogRefSchema,
  purchaseRefSchema,
  entityRefSchema,
  queryCursorSchema,
  completenessSchema,
  candidatePageSchema,
} from './contracts';
import { CANDIDATE_LIMIT } from './candidate-contracts';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Source quantities/prices have 2 decimal places; their products can have 4.
export const purchaseDecimalSchema = z
  .string()
  .max(60)
  .regex(/^(?:0|[1-9]\d*)\.\d{2,4}$/);
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .nullable();
const unit = z.enum(['STRAND', 'BEAD', 'GRAM', 'PIECE']);
export const purchaseQuerySchema = z
  .strictObject({
    query: assistantQuerySchema,
    selectedPurchases: z.array(purchaseRefSchema).max(CANDIDATE_LIMIT).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.query.subject !== 'purchases')
      ctx.addIssue({ code: 'custom', message: 'Purchase query required' });
    const refs = value.selectedPurchases ?? [];
    if (new Set(refs.map((r) => `${r.type}:${r.id}`)).size !== refs.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate selected purchases' });
    if (
      refs.some(
        (r) =>
          !value.query.itemTypes.includes(r.type === 'MATERIAL_PURCHASE' ? 'MATERIAL' : 'PRODUCT'),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Selected purchase type outside query' });
  });
export const purchaseEntrySchema = z
  .strictObject({
    item: catalogRefSchema,
    purchase: purchaseRefSchema,
    name: z.string(),
    code: z.string().nullable(),
    batch: z.strictObject({
      id: entityRefSchema.shape.id,
      name: z.string(),
      receivedAt: z.iso.date(),
    }),
    distributor: z.strictObject({ id: entityRefSchema.shape.id, name: z.string() }),
    quantity: purchaseDecimalSchema.nullable(),
    unit,
    unitPrice: purchaseDecimalSchema.nullable(),
    amount: purchaseDecimalSchema.nullable(),
    amountBasis: z.enum(['recorded_total', 'quantity_times_unit_price', 'unknown']),
    currency,
    currencyBasis: z.enum(['business_default', 'recorded', 'unknown']),
  })
  .superRefine((row, ctx) => {
    if (
      (row.item.type === 'MATERIAL') !== (row.purchase.type === 'MATERIAL_PURCHASE') ||
      (row.item.type === 'PRODUCT') !== (row.unit === 'PIECE')
    )
      ctx.addIssue({ code: 'custom', message: 'Incompatible purchase identity/unit' });
    if ((row.amount === null) !== (row.amountBasis === 'unknown'))
      ctx.addIssue({ code: 'custom', message: 'Inconsistent amount basis' });
    if ((row.currency === null) !== (row.currencyBasis === 'unknown'))
      ctx.addIssue({ code: 'custom', message: 'Inconsistent currency basis' });
  });
export const purchaseTotalsSchema = z.strictObject({
  purchaseEntryCount: count,
  catalogItemCount: count,
  amounts: z
    .array(
      z.strictObject({
        currency,
        knownAmount: purchaseDecimalSchema,
        unknownAmountEntryCount: count,
        businessDefaultCurrencyEntryCount: count,
      }),
    )
    .max(CANDIDATE_LIMIT),
  quantities: z
    .array(
      z.strictObject({
        unit,
        knownQuantity: purchaseDecimalSchema,
        unknownQuantityEntryCount: count,
      }),
    )
    .max(4),
});
export const purchaseSummarySchema = z.strictObject({
  basis: z.enum(['hard_scope', 'selected_purchases']),
  scopeCandidateCount: count,
  totals: purchaseTotalsSchema,
  byDistributor: z
    .array(
      z.strictObject({
        distributor: purchaseEntrySchema.shape.distributor,
        totals: purchaseTotalsSchema,
      }),
    )
    .max(CANDIDATE_LIMIT),
  byCatalog: z
    .array(
      z.strictObject({
        item: catalogRefSchema,
        name: z.string(),
        totals: purchaseTotalsSchema,
      }),
    )
    .max(CANDIDATE_LIMIT),
});
export const purchasePageSchema = z
  .strictObject({
    version: z.literal('v1'),
    runId: z.uuid(),
    queriedAt: z.iso.datetime({ offset: true }),
    query: purchaseQuerySchema,
    items: z.array(purchaseEntrySchema).max(100),
    nextCursor: queryCursorSchema.nullable(),
    completeness: completenessSchema,
    summary: purchaseSummarySchema,
  })
  .superRefine((page, ctx) => {
    const identityPage = candidatePageSchema.safeParse({
      version: page.version,
      runId: page.runId,
      queriedAt: page.queriedAt,
      query: page.query.query,
      items: page.items.map((row) => ({ item: row.item, purchase: row.purchase, evidence: [] })),
      nextCursor: page.nextCursor,
      completeness: page.completeness,
    });
    if (!identityPage.success)
      ctx.addIssue({ code: 'custom', message: 'Invalid purchase pagination/completeness' });
    if (
      page.summary.totals.purchaseEntryCount !== page.completeness.totalCandidates ||
      page.completeness.countBasis !== 'purchase_entry' ||
      page.summary.scopeCandidateCount < page.summary.totals.purchaseEntryCount ||
      page.items.length > page.query.query.pagination.limit ||
      new Set(page.items.map((r) => `${r.purchase.type}:${r.purchase.id}`)).size !==
        page.items.length
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent purchase page' });
  });
export type PurchaseQuery = z.infer<typeof purchaseQuerySchema>;
export type PurchaseEntry = z.infer<typeof purchaseEntrySchema>;
export type PurchaseTotals = z.infer<typeof purchaseTotalsSchema>;
export type PurchaseSummary = z.infer<typeof purchaseSummarySchema>;
