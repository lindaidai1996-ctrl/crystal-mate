import { z } from 'zod';
import {
  purchaseEntrySchema,
  purchaseSummarySchema,
  type PurchaseEntry,
  type PurchaseSummary,
} from './purchase-contracts';
import { stockResultSchema, type StockResult } from './stock-contracts';
import { catalogDisplaySchema, type CatalogDisplay } from './display-data';
import { catalogRefSchema } from './contracts';
import { locationResolutionSchema, type LocationResolution } from './reference-contracts';

const uncertainPurchasesSchema = z.object({
  items: z.array(purchaseEntrySchema.extend({ reason: z.string().max(500) })).max(5000),
  summary: purchaseSummarySchema,
});

export type AssistantBrowserResults = {
  kind: 'purchases' | 'catalog' | 'stock' | 'distributors';
  stockMode?: StockResult['request']['mode'];
  distributors?: Pick<
    LocationResolution,
    'confirmed' | 'uncertain' | 'scannedCount' | 'scanComplete'
  >;
  queriedAt: string;
  purchases: PurchaseEntry[];
  catalog: CatalogDisplay[];
  stock: Omit<StockResult, 'request'> | null;
  summary: PurchaseSummary | null;
  legacyDetails: boolean;
  selectionIsPartial?: boolean;
  uncertainPurchases?: z.infer<typeof uncertainPurchasesSchema>;
};

const purchaseFacts = z.object({
  items: z.array(purchaseEntrySchema).max(5000),
  summary: purchaseSummarySchema,
  queriedAt: z.iso.datetime({ offset: true }),
  catalog: z.array(catalogDisplaySchema).max(5000).optional(),
  stock: stockResultSchema.optional(),
});
const catalogFacts = z.object({
  items: z.array(catalogRefSchema).max(5000),
  queriedAt: z.iso.datetime({ offset: true }),
  catalog: z.array(catalogDisplaySchema).max(5000).optional(),
  stock: stockResultSchema.optional(),
});
export function assistantResultView(
  raw: unknown,
  privacy: boolean,
): AssistantBrowserResults | null {
  const wrapped = z.object({ facts: z.unknown() }).safeParse(raw);
  if (!wrapped.success || !wrapped.data.facts) return null;
  const facts = wrapped.data.facts;
  const locations = z
    .object({
      kind: z.literal('distributors'),
      resolution: locationResolutionSchema,
      queriedAt: z.iso.datetime({ offset: true }),
    })
    .safeParse(facts);
  if (locations.success) {
    const { resolution, queriedAt } = locations.data;
    const project = (rows: LocationResolution['confirmed']) =>
      rows.map((row) => ({
        distributor: row.distributor,
        name: privacy ? '' : row.name,
        area: privacy ? '' : row.area,
        reason: row.reason,
        evidence: privacy
          ? []
          : row.evidence.map(({ field, matchedText, start, end }) => ({
              field,
              matchedText,
              start,
              end,
            })),
      }));
    return {
      kind: 'distributors',
      queriedAt,
      purchases: [],
      catalog: [],
      stock: null,
      summary: null,
      legacyDetails: false,
      selectionIsPartial: resolution.uncertain.length > 0,
      distributors: {
        confirmed: project(resolution.confirmed),
        uncertain: project(resolution.uncertain),
        scannedCount: resolution.scannedCount,
        scanComplete: resolution.scanComplete,
      },
    };
  }
  const purchases = purchaseFacts.safeParse(facts);
  const fields = z.record(z.string(), z.unknown()).safeParse(facts);
  const current = stockResultSchema.safeParse(
    fields.success
      ? Object.fromEntries(Object.entries(fields.data).filter(([key]) => key !== 'catalog'))
      : facts,
  );
  const catalog = catalogFacts.safeParse(facts);
  if (!purchases.success && !current.success && !catalog.success) return null;
  const data = purchases.success ? purchases.data : catalog.success ? catalog.data : null;
  const stock = current.success ? current.data : data?.stock;
  const safeStock = stock
    ? {
        version: stock.version,
        queriedAt: stock.queriedAt,
        scopeCandidateCount: stock.scopeCandidateCount,
        selectedCandidateCount: stock.selectedCandidateCount,
        catalogItemCount: stock.catalogItemCount,
        traversal: stock.traversal,
        semanticEvaluation: stock.semanticEvaluation,
        catalogStock: stock.catalogStock.map((row) => ({ ...row, name: privacy ? '' : row.name })),
        sourceStock: stock.sourceStock.map((row) => ({ ...row, name: privacy ? '' : row.name })),
        quantities: stock.quantities,
      }
    : null;
  const stockCatalog = z.object({ catalog: z.array(catalogDisplaySchema) }).safeParse(facts);
  const descriptions = data?.catalog ?? (stockCatalog.success ? stockCatalog.data.catalog : null);
  const fallbackRefs = catalog.success
    ? catalog.data.items
    : (stock?.catalogStock.map((row) => row.item) ?? []);
  const uncertain = z.object({ uncertainPurchases: uncertainPurchasesSchema }).safeParse(raw);
  return {
    ...(!privacy && purchases.success && uncertain.success
      ? { uncertainPurchases: uncertain.data.uncertainPurchases }
      : {}),
    selectionIsPartial: z
      .object({
        relevance: z.object({ completeness: z.object({ uncertain: z.number().positive() }) }),
      })
      .safeParse(raw).success,
    stockMode: stock?.request.mode,
    kind: purchases.success ? 'purchases' : current.success ? 'stock' : 'catalog',
    queriedAt: data?.queriedAt ?? current.data!.queriedAt,
    purchases: purchases.success
      ? purchases.data.items.map((row) =>
          privacy
            ? {
                ...row,
                name: '',
                code: null,
                amount: null,
                unitPrice: null,
                batch: { ...row.batch, name: '' },
                distributor: { ...row.distributor, name: '' },
              }
            : row,
        )
      : [],
    catalog: (
      descriptions ??
      fallbackRefs.map((item) => ({
        item,
        purchase: null,
        name:
          stock?.catalogStock.find((row) => row.item.id === item.id && row.item.type === item.type)
            ?.name ?? '',
        code: null,
        imageKey: null,
        lengthMm: null,
        widthMm: null,
        heightMm: null,
      }))
    ).map((row) => (privacy ? { ...row, name: '', code: null } : row)),
    stock: safeStock,
    summary: purchases.success
      ? privacy
        ? {
            ...purchases.data.summary,
            totals: { ...purchases.data.summary.totals, amounts: [] },
            byDistributor: purchases.data.summary.byDistributor.map((group) => ({
              distributor: { ...group.distributor, name: '' },
              totals: { ...group.totals, amounts: [] },
            })),
            byCatalog: purchases.data.summary.byCatalog.map((group) => ({
              ...group,
              name: '',
              totals: { ...group.totals, amounts: [] },
            })),
          }
        : purchases.data.summary
      : null,
    legacyDetails: !data?.catalog && !stockCatalog.success,
  };
}

export function assistantRecordHref(
  item: CatalogDisplay['item'],
  purchase?: PurchaseEntry['purchase'] | null,
) {
  return item.type === 'MATERIAL' && purchase?.type === 'MATERIAL_PURCHASE'
    ? `/admin/materials/${item.id}/batches/${purchase.id}`
    : `/admin/${item.type === 'MATERIAL' ? 'materials' : 'products'}/${item.id}`;
}
