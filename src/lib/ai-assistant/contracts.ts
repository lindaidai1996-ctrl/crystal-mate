import { z } from 'zod';

export const ASSISTANT_CONTRACT_VERSION = 'v1' as const;
export const ASSISTANT_TIMEZONE = 'Asia/Shanghai' as const;
const id = z.string().cuid();
const text = z.string().trim().min(1).max(500);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });

export const catalogRefSchema = z.strictObject({
  type: z.enum(['MATERIAL', 'PRODUCT']),
  id,
});
export const purchaseRefSchema = z.strictObject({
  type: z.enum(['MATERIAL_PURCHASE', 'PRODUCT_PURCHASE']),
  id,
});
export const entityRefSchema = z.strictObject({
  type: z.enum([
    'MATERIAL',
    'PRODUCT',
    'MATERIAL_PURCHASE',
    'PRODUCT_PURCHASE',
    'DISTRIBUTOR',
    'MATERIAL_CATEGORY',
    'PRODUCT_CATEGORY',
    'TAG',
    'BATCH',
  ]),
  id,
});

function unique<T>(values: T[]) {
  return new Set(values.map((value) => JSON.stringify(value))).size === values.length;
}
const ids = z.array(id).min(1).max(200).refine(unique, 'Duplicate IDs');
const catalogRefs = z.array(catalogRefSchema).min(1).max(200).refine(unique, 'Duplicate items');

// Batch.receivedAt is a calendar date, not a local instant. All ranges are [from, to).
export const purchaseDateRangeSchema = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => from < to, 'Empty or reversed purchase date range');
export const createdAtRangeSchema = z
  .strictObject({
    entity: z.enum(['catalog', 'purchase', 'batch', 'distributor']),
    from: instant,
    to: instant,
  })
  .refine(({ from, to }) => Date.parse(from) < Date.parse(to), 'Empty or reversed createdAt range');

export const hardConditionsSchema = z.strictObject({
  purchaseDate: purchaseDateRangeSchema.optional(),
  createdAt: createdAtRangeSchema.optional(),
  distributorIds: ids.optional(),
  items: catalogRefs.optional(),
  categories: z
    .array(
      z.strictObject({
        type: z.enum(['MATERIAL_CATEGORY', 'PRODUCT_CATEGORY']),
        id,
        includeDescendants: z.boolean(),
      }),
    )
    .min(1)
    .max(100)
    .refine(unique, 'Duplicate categories')
    .optional(),
  tagIds: ids.optional(),
  location: z.strictObject({ text, kind: z.enum(['exact_place', 'area']) }).optional(),
});
export const semanticConditionSchema = z.strictObject({
  concept: z.enum(['material', 'purpose', 'form', 'other']),
  text,
  relation: z.enum(['is', 'used_with', 'not']),
});

// A cursor is a position, never an authorization grant. P2-03 must bind it to the
// authenticated scope + normalized query and validate its run before using it.
export const queryCursorSchema = z.strictObject({
  runId: z.uuid(),
  scopeKey: z.string().regex(/^[a-f0-9]{64}$/),
  after: entityRefSchema,
});
export const queryPaginationSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: queryCursorSchema.optional(),
});

export const assistantQuerySchema = z
  .strictObject({
    version: z.literal(ASSISTANT_CONTRACT_VERSION),
    subject: z.enum(['catalog', 'purchases']),
    itemTypes: z
      .array(z.enum(['MATERIAL', 'PRODUCT']))
      .min(1)
      .max(2)
      .refine(unique),
    hard: hardConditionsSchema,
    semantic: z.array(semanticConditionSchema).max(20),
    ruleVersion: z.literal('v1'),
    pagination: queryPaginationSchema,
  })
  .superRefine((query, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (query.subject === 'catalog' && query.hard.purchaseDate)
      issue('purchaseDate requires a purchases query');
    if (
      query.hard.createdAt &&
      query.subject === 'catalog' &&
      query.hard.createdAt.entity !== 'catalog'
    )
      issue('Catalog queries only support catalog createdAt');
    if (query.hard.items?.some((item) => !query.itemTypes.includes(item.type)))
      issue('Item reference is outside itemTypes');
    if (
      query.hard.categories?.some(
        (category) =>
          !query.itemTypes.includes(category.type === 'MATERIAL_CATEGORY' ? 'MATERIAL' : 'PRODUCT'),
      )
    )
      issue('Category reference is outside itemTypes');
    const after = query.pagination.cursor?.after;
    const allowedCursorTypes = query.itemTypes.map((type) =>
      query.subject === 'purchases'
        ? type === 'MATERIAL'
          ? 'MATERIAL_PURCHASE'
          : 'PRODUCT_PURCHASE'
        : type,
    );
    if (after && !allowedCursorTypes.some((type) => type === after.type))
      issue('Cursor type is outside query');
  });

export const fieldEvidenceSchema = z.strictObject({
  entity: entityRefSchema,
  field: z.enum([
    'name',
    'aliases',
    'notes',
    'description',
    'area',
    'address',
    'receivedAt',
    'createdAt',
  ]),
  value: z.union([z.string().max(20000), z.array(z.string().max(2000)).max(200), z.null()]),
});

const candidateIdentityFields = {
  item: catalogRefSchema,
  purchase: purchaseRefSchema.nullable(),
};
function compatiblePurchase(value: {
  item: z.infer<typeof catalogRefSchema>;
  purchase: z.infer<typeof purchaseRefSchema> | null;
}) {
  return (
    !value.purchase ||
    value.purchase.type ===
      (value.item.type === 'MATERIAL' ? 'MATERIAL_PURCHASE' : 'PRODUCT_PURCHASE')
  );
}
// Category/tag evidence carries the actual related entity ID, not a made-up
// nested field path. The service supplies only fields needed by this query.
export const queryCandidateSchema = z
  .strictObject({
    ...candidateIdentityFields,
    evidence: z.array(fieldEvidenceSchema).max(200),
  })
  .refine(compatiblePurchase, 'Purchase type does not match catalog type');
export const semanticDecisionSchema = z
  .strictObject({
    ...candidateIdentityFields,
    status: z.enum(['include', 'exclude', 'uncertain']),
    evidence: z.array(fieldEvidenceSchema).min(1).max(50),
    reason: text,
    ruleVersion: z.literal('v1'),
  })
  .refine(compatiblePurchase, 'Purchase type does not match catalog type');

export function candidateKey(candidate: z.infer<typeof queryCandidateSchema>) {
  return [
    candidate.item.type,
    candidate.item.id,
    candidate.purchase?.type ?? '',
    candidate.purchase?.id ?? '',
  ].join(':');
}

// Shape validation alone cannot prove an ID exists or that evidence is real.
// Bind decisions to the exact server-returned candidate batch, including values.
export function decisionsForCandidatesSchema(candidates: z.infer<typeof queryCandidateSchema>[]) {
  const parsed = z.array(queryCandidateSchema).parse(candidates);
  const byKey = new Map(parsed.map((candidate) => [candidateKey(candidate), candidate]));
  if (byKey.size !== parsed.length) throw new Error('Duplicate candidates');
  return z
    .array(semanticDecisionSchema)
    .max(parsed.length)
    .superRefine((decisions, ctx) => {
      const seen = new Set<string>();
      decisions.forEach((decision, index) => {
        const key = candidateKey(decision);
        const candidate = byKey.get(key);
        if (!candidate || seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: 'Unknown or duplicate candidate',
          });
        } else if (
          decision.evidence.some(
            (evidence) =>
              !candidate.evidence.some(
                (actual) =>
                  actual.entity.type === evidence.entity.type &&
                  actual.entity.id === evidence.entity.id &&
                  actual.field === evidence.field &&
                  JSON.stringify(actual.value) === JSON.stringify(evidence.value),
              ),
          )
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'evidence'],
            message: 'Unreturned evidence',
          });
        }
        seen.add(key);
      });
    });
}

export const completenessSchema = z
  .strictObject({
    scope: z.enum(['resolved', 'unresolved']),
    traversal: z.enum(['not_started', 'partial', 'complete']),
    evaluation: z.enum(['not_started', 'partial', 'complete']),
    countBasis: z.enum(['catalog', 'purchase_entry']),
    totalCandidates: count.nullable(),
    readCandidates: count,
    uniqueCatalogItems: count,
    evaluatedCandidates: count,
    included: count,
    excluded: count,
    uncertain: count,
    notEvaluated: count,
    unreadCandidates: count.nullable(),
    stopReason: z
      .enum([
        'running',
        'scope_unresolved',
        'budget',
        'timeout',
        'query_failed',
        'model_failed',
        'cancelled',
      ])
      .nullable(),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      value.evaluatedCandidates !== value.included + value.excluded + value.uncertain ||
      value.readCandidates !== value.evaluatedCandidates + value.notEvaluated ||
      value.uniqueCatalogItems > value.readCandidates ||
      (value.countBasis === 'catalog' && value.uniqueCatalogItems !== value.readCandidates)
    )
      issue('Inconsistent candidate counts');
    if (
      value.totalCandidates === null
        ? value.unreadCandidates !== null
        : value.readCandidates > value.totalCandidates ||
          value.unreadCandidates !== value.totalCandidates - value.readCandidates
    )
      issue('Inconsistent total/unread counts');
    if (value.traversal === 'not_started' && value.readCandidates !== 0)
      issue('Unstarted traversal cannot have read candidates');
    if (value.evaluation === 'not_started' && value.evaluatedCandidates !== 0)
      issue('Unstarted evaluation cannot have evaluated candidates');
    if (
      value.scope === 'unresolved' &&
      (value.totalCandidates !== null || value.readCandidates !== 0)
    )
      issue('Unresolved scope must not be queried or report a known total');
    if (
      value.traversal === 'complete' &&
      (value.scope !== 'resolved' || value.totalCandidates === null || value.unreadCandidates !== 0)
    )
      issue('Complete traversal requires a resolved, fully read scope');
    if (
      value.evaluation === 'complete' &&
      (value.traversal !== 'complete' || value.notEvaluated !== 0)
    )
      issue('Complete evaluation requires all candidates to be read and evaluated');
    const complete = value.traversal === 'complete' && value.evaluation === 'complete';
    if (complete !== (value.stopReason === null)) issue('Completion and stopReason disagree');
  });

export const candidatePageSchema = z
  .strictObject({
    version: z.literal(ASSISTANT_CONTRACT_VERSION),
    runId: z.uuid(),
    queriedAt: instant,
    query: assistantQuerySchema,
    items: z.array(queryCandidateSchema).max(100),
    nextCursor: queryCursorSchema.nullable(),
    completeness: completenessSchema,
  })
  .superRefine((page, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (page.items.length > page.query.pagination.limit) issue('Page exceeds requested limit');
    if (new Set(page.items.map(candidateKey)).size !== page.items.length)
      issue('Duplicate page candidates');
    if (
      page.items.some(
        (candidate) =>
          !page.query.itemTypes.includes(candidate.item.type) ||
          (page.query.subject === 'purchases') !== (candidate.purchase !== null),
      ) ||
      page.completeness.countBasis !==
        (page.query.subject === 'purchases' ? 'purchase_entry' : 'catalog')
    )
      issue('Candidate type/count basis does not match query');
    if (page.completeness.readCandidates < page.items.length)
      issue('Read count is smaller than this page');
    if (page.nextCursor && page.nextCursor.runId !== page.runId) issue('Cursor run does not match');
    const previousCursor = page.query.pagination.cursor;
    if (previousCursor && previousCursor.runId !== page.runId)
      issue('Query cursor run does not match');
    if (previousCursor && page.nextCursor && previousCursor.scopeKey !== page.nextCursor.scopeKey)
      issue('Cursor scope changed');
    if (page.nextCursor) {
      const last = page.items.at(-1);
      const after = last?.purchase ?? last?.item;
      if (
        !after ||
        after.type !== page.nextCursor.after.type ||
        after.id !== page.nextCursor.after.id
      )
        issue('Next cursor must point to the last returned candidate');
    }
    if (page.nextCursor && page.completeness.traversal === 'complete')
      issue('Complete traversal cannot have a next cursor');
  });

export type AssistantQuery = z.infer<typeof assistantQuerySchema>;
export type EntityRef = z.infer<typeof entityRefSchema>;
export type QueryCandidate = z.infer<typeof queryCandidateSchema>;
export type SemanticDecision = z.infer<typeof semanticDecisionSchema>;
export type QueryCompleteness = z.infer<typeof completenessSchema>;
export type CandidatePage = z.infer<typeof candidatePageSchema>;
