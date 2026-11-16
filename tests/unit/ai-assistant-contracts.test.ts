import { describe, expect, it } from 'vitest';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import {
  assistantQuerySchema,
  candidatePageSchema,
  completenessSchema,
  createdAtRangeSchema,
  decisionsForCandidatesSchema,
  purchaseDateRangeSchema,
  queryCandidateSchema,
  type QueryCompleteness,
} from '../../src/lib/ai-assistant/contracts';

// Frozen development fixture, not a database query or an assistant evaluation.
const query = assistantQuerySchema.parse({
  version: 'v1',
  subject: 'purchases',
  itemTypes: ['MATERIAL'],
  hard: {
    purchaseDate: { from: baseline.scope.dateFromInclusive, to: baseline.scope.dateToExclusive },
    location: { text: '荔湾广场', kind: 'exact_place' },
    distributorIds: baseline.scope.distributorIds,
  },
  semantic: [
    { concept: 'material', text: '绿松石', relation: 'is' },
    { concept: 'purpose', text: '制作配件（含配饰、圆珠）', relation: 'is' },
  ],
  ruleVersion: 'v1',
  pagination: { limit: 50 },
});
const candidates = baseline.scopedCandidates.map((row) =>
  queryCandidateSchema.parse({
    item: { type: 'MATERIAL', id: row.materialId },
    purchase: { type: 'MATERIAL_PURCHASE', id: row.id },
    evidence: [
      { entity: { type: 'MATERIAL', id: row.materialId }, field: 'name', value: row.name },
      { entity: { type: 'MATERIAL', id: row.materialId }, field: 'aliases', value: row.aliases },
    ],
  }),
);
const runId = 'a46119a4-935c-46b5-a0be-fcd5fc74c766';
const completed: QueryCompleteness = {
  scope: 'resolved',
  traversal: 'complete',
  evaluation: 'complete',
  countBasis: 'purchase_entry',
  totalCandidates: 44,
  readCandidates: 44,
  uniqueCatalogItems: 44,
  evaluatedCandidates: 44,
  included: 11,
  excluded: 33,
  uncertain: 0,
  notEvaluated: 0,
  unreadCandidates: 0,
  stopReason: null,
};
const page = {
  version: 'v1',
  runId,
  queriedAt: baseline.capturedAt,
  query,
  items: candidates,
  nextCursor: null,
  completeness: completed,
};
const decision = {
  item: candidates[0].item,
  purchase: candidates[0].purchase,
  status: 'exclude',
  evidence: [candidates[0].evidence[0]],
  reason: '构造判定，用于验证引用边界，不是模型评估结果',
  ruleVersion: 'v1',
};

describe('assistant query contract', () => {
  it('expresses REAL-01 without turning soft semantics into required tags', () => {
    expect(query.hard.tagIds).toBeUndefined();
    expect(query.hard.distributorIds).toHaveLength(7);
    expect(query.hard.purchaseDate).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(candidatePageSchema.parse(page).items).toHaveLength(44);
  });

  it.each([
    { hard: { distributorIds: ['invalid'] } },
    { hard: { distributorIds: [] } },
    {
      hard: {
        distributorIds: [baseline.scope.distributorIds[0], baseline.scope.distributorIds[0]],
      },
    },
    { hard: { ownerId: baseline.scope.distributorIds[0] } },
    { hard: { sql: 'SELECT * FROM Material' } },
    { hard: { items: [{ type: 'PRODUCT', id: candidates[0].item.id }] } },
    {
      hard: {
        categories: [
          { type: 'PRODUCT_CATEGORY', id: candidates[0].item.id, includeDescendants: true },
        ],
      },
    },
    { itemTypes: [] },
    { itemTypes: ['MATERIAL', 'MATERIAL'] },
    { semantic: [{ concept: 'material', text: ' ', relation: 'is' }] },
    { pagination: { limit: 101 } },
    { pagination: { limit: '5' } },
    { pagination: { limit: 1, page: 2 } },
    { pagination: { cursor: { runId, scopeKey: 'invalid', after: candidates[0].purchase } } },
    { pagination: { cursor: { runId, scopeKey: 'a'.repeat(64), after: candidates[0].item } } },
    { accountId: candidates[0].item.id },
  ])('rejects invalid or unregistered parameters: %j', (patch) => {
    expect(assistantQuerySchema.safeParse({ ...query, ...patch }).success).toBe(false);
  });

  it.each([
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-11-01T00:00:00Z', to: '2026-12-01' },
    { from: '2026-12-01', to: '2026-11-01' },
    { from: '2026-11-01', to: '2026-11-01' },
  ])('rejects invalid purchase calendar ranges: %j', (range) => {
    expect(purchaseDateRangeSchema.safeParse(range).success).toBe(false);
  });

  it('keeps creation instants separate and compares offsets by actual time', () => {
    const createdAt = {
      entity: 'catalog',
      from: '2026-11-01T00:00:00+08:00',
      to: '2026-12-01T00:00:00+08:00',
    };
    expect(
      assistantQuerySchema.parse({ ...query, hard: { ...query.hard, createdAt } }).hard,
    ).toHaveProperty('purchaseDate');
    expect(
      createdAtRangeSchema.safeParse({ ...createdAt, from: '2026-11-01T00:00:00' }).success,
    ).toBe(false);
    expect(
      createdAtRangeSchema.safeParse({
        ...createdAt,
        from: '2026-11-01T00:00:00Z',
        to: '2026-11-01T01:00:00+08:00',
      }).success,
    ).toBe(false);
    expect(assistantQuerySchema.safeParse({ ...query, subject: 'catalog' }).success).toBe(false);
    expect(
      assistantQuerySchema.parse({ ...query, subject: 'catalog', hard: { createdAt } }).subject,
    ).toBe('catalog');
  });
});

describe('assistant evidence boundaries', () => {
  it('allows a subset without inventing judgments for missing candidates', () => {
    expect(decisionsForCandidatesSchema(candidates).parse([decision])).toHaveLength(1);
    expect(decisionsForCandidatesSchema(candidates).parse([])).toEqual([]);
  });

  it('rejects nonexistent, swapped or duplicate references and forged evidence', () => {
    const schema = decisionsForCandidatesSchema(candidates);
    const otherId = baseline.scope.distributorIds[0];
    for (const invalid of [
      { ...decision, item: { ...decision.item, id: otherId } },
      { ...decision, purchase: candidates[1].purchase },
      { ...decision, purchase: { ...decision.purchase, type: 'PRODUCT_PURCHASE' } },
      { ...decision, status: 'not_evaluated' },
      { ...decision, evidence: [] },
      { ...decision, evidence: [{ ...decision.evidence[0], value: '虚构绿松石' }] },
      { ...decision, evidence: [{ ...decision.evidence[0], field: 'notes' }] },
      { ...decision, evidence: [candidates[1].evidence[0]] },
    ])
      expect(schema.safeParse([invalid]).success).toBe(false);
    expect(schema.safeParse([decision, decision]).success).toBe(false);
    expect(() => decisionsForCandidatesSchema([candidates[0], candidates[0]])).toThrow();
  });

  it('retains two purchases of one catalog item as distinct candidates', () => {
    const anotherPurchase = { ...candidates[0], purchase: candidates[1].purchase };
    expect(
      decisionsForCandidatesSchema([candidates[0], anotherPurchase]).parse([
        decision,
        { ...decision, purchase: anotherPurchase.purchase },
      ]),
    ).toHaveLength(2);
  });
});

describe('assistant completeness and pagination', () => {
  const partial: QueryCompleteness = {
    ...completed,
    traversal: 'partial',
    evaluation: 'partial',
    readCandidates: 20,
    uniqueCatalogItems: 20,
    evaluatedCandidates: 10,
    included: 3,
    excluded: 5,
    uncertain: 2,
    notEvaluated: 10,
    unreadCandidates: 24,
    stopReason: 'budget',
  };

  it('separates read-but-unjudged, unread and uncertain candidates', () => {
    expect(completenessSchema.parse(partial)).toMatchObject({
      notEvaluated: 10,
      unreadCandidates: 24,
      uncertain: 2,
    });
    expect(completenessSchema.parse({ ...completed, included: 10, uncertain: 1 }).evaluation).toBe(
      'complete',
    );
  });

  it.each([
    { included: 12 },
    { notEvaluated: 1 },
    { uniqueCatalogItems: 45 },
    { totalCandidates: null },
    { unreadCandidates: 1 },
    { scope: 'unresolved' },
    { traversal: 'not_started' },
    { evaluation: 'not_started' },
    { stopReason: 'model_failed' },
  ])('rejects inconsistent completion claims: %j', (patch) => {
    expect(completenessSchema.safeParse({ ...completed, ...patch }).success).toBe(false);
  });

  it('does not promote a partial run to complete', () => {
    expect(completenessSchema.safeParse({ ...partial, evaluation: 'complete' }).success).toBe(
      false,
    );
    expect(completenessSchema.safeParse({ ...partial, stopReason: null }).success).toBe(false);
  });

  it('distinguishes an empty completed scope from a failure with unknown total', () => {
    const empty = {
      ...completed,
      totalCandidates: 0,
      readCandidates: 0,
      uniqueCatalogItems: 0,
      evaluatedCandidates: 0,
      included: 0,
      excluded: 0,
    };
    expect(completenessSchema.parse(empty).stopReason).toBeNull();
    for (const stopReason of ['query_failed', 'model_failed', 'timeout', 'cancelled'] as const) {
      expect(
        completenessSchema.parse({
          ...empty,
          totalCandidates: null,
          unreadCandidates: null,
          traversal: 'not_started',
          evaluation: 'not_started',
          stopReason,
        }).stopReason,
      ).toBe(stopReason);
    }
  });

  it('reports unresolved locations without executing a broader query', () => {
    const unresolved = {
      ...completed,
      scope: 'unresolved',
      traversal: 'not_started',
      evaluation: 'not_started',
      totalCandidates: null,
      unreadCandidates: null,
      readCandidates: 0,
      uniqueCatalogItems: 0,
      evaluatedCandidates: 0,
      included: 0,
      excluded: 0,
      stopReason: 'scope_unresolved',
    };
    expect(completenessSchema.parse(unresolved).totalCandidates).toBeNull();
    expect(completenessSchema.safeParse({ ...unresolved, totalCandidates: 44 }).success).toBe(
      false,
    );
  });

  it('supports catalog pages without claiming they contain purchase rows', () => {
    const catalogPage = {
      ...page,
      query: { ...query, subject: 'catalog', hard: {} },
      items: [{ ...candidates[0], purchase: null }],
      completeness: {
        ...completed,
        countBasis: 'catalog',
        totalCandidates: 1,
        readCandidates: 1,
        uniqueCatalogItems: 1,
        evaluatedCandidates: 1,
        included: 1,
        excluded: 0,
      },
    };
    expect(candidatePageSchema.parse(catalogPage).items[0].purchase).toBeNull();
    expect(candidatePageSchema.safeParse({ ...catalogPage, items: [candidates[0]] }).success).toBe(
      false,
    );
  });

  it('checks page size, row uniqueness, cursor position and query identity', () => {
    const items = candidates.slice(0, 20);
    const nextCursor = { runId, scopeKey: 'a'.repeat(64), after: items[19].purchase };
    const valid = { ...page, items, nextCursor, completeness: partial };
    expect(candidatePageSchema.parse(valid).items).toHaveLength(20);
    for (const invalid of [
      { ...valid, query: { ...query, pagination: { limit: 5 } } },
      { ...valid, items: [items[0], items[0]] },
      { ...valid, nextCursor: { ...nextCursor, after: items[0].purchase } },
      { ...valid, nextCursor: { ...nextCursor, runId: 'cd5c08b4-7879-471c-8895-72fef0d7e9a9' } },
      {
        ...valid,
        query: {
          ...query,
          pagination: { limit: 50, cursor: { ...nextCursor, scopeKey: 'b'.repeat(64) } },
        },
      },
      { ...valid, completeness: completed },
      { ...valid, completeness: { ...partial, countBasis: 'catalog', uniqueCatalogItems: 19 } },
      { ...valid, items: [{ ...items[0], purchase: null }] },
    ])
      expect(candidatePageSchema.safeParse(invalid).success).toBe(false);
  });
});
