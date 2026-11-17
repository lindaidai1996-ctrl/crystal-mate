import {
  normalizeAssistantFollowup,
  planToolSchema,
  applyAssistantPlan,
} from '@/lib/ai-assistant/orchestration-contracts';
import { expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { frozenBusinessFixture } from '../../scripts/lib/assistant-acceptance-fixture';
import { resolveLocationRows } from '@/lib/ai-assistant/reference-resolution';
import { assistantQuerySchema } from '@/lib/ai-assistant/contracts';
import { semanticQuery } from '../fixtures/ai-assistant-semantics';
import { createAssistantFacts } from '@/lib/ai-assistant/orchestration-facts';
import { readAssistantRecall } from '@/lib/ai-assistant/recall-data';
import { readAssistantPurchases } from '@/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '@/lib/ai-assistant/stock-data';
import { assessSemanticCandidate } from '@/lib/ai-assistant/semantic-policy';
import { assistantResultView } from '@/lib/ai-assistant/result-view';
import type { RelevanceModel } from '@/lib/ai-assistant/relevance-model';
import {
  buildRelevanceInput,
  relevanceWireInput,
  restoreRelevanceWireOutput,
} from '@/lib/ai-assistant/relevance-model';
import {
  relevanceCandidate,
  validateRelevanceOutput,
} from '@/lib/ai-assistant/relevance-contracts';
import { boundaryCases, boundaryQuery } from '../fixtures/ai-assistant-evaluation';
import { newAssistantExecution, runAssistantLoop } from '@/lib/ai-assistant/orchestrator';
import { RelevanceRuns } from '@/lib/ai-assistant/relevance-runs';

it('binds compact wire references and explicit evidence indexes without weakening validation', () => {
  const candidate = relevanceCandidate(boundaryCases[0].detail.candidate);
  const input = buildRelevanceInput(boundaryQuery, [candidate], []);
  const wire = relevanceWireInput(input);
  expect(wire.candidates[0].key).toBe('C0');
  expect(JSON.stringify(wire)).not.toContain(candidate.item.id);
  expect(wire.candidates[0].evidence.map((e) => e.index)).toEqual(
    wire.candidates[0].validEvidenceIndexes,
  );
  const decision = { key: 'C0', status: 'include', evidenceIndexes: [0], reason: '名称依据' };
  const validate = (row: unknown) =>
    validateRelevanceOutput(
      restoreRelevanceWireOutput({ decisions: [row] }, input),
      [candidate],
      boundaryQuery.semantic,
    );
  expect(validate(decision)[0].item).toEqual(candidate.item);
  expect(() => validate({ ...decision, key: 'C99' })).toThrow('MODEL_INVALID_REFERENCE');
  expect(() => validate({ ...decision, key: input.candidates[0].key })).toThrow(
    'MODEL_INVALID_REFERENCE',
  );
  expect(() => validate({ ...decision, evidenceIndexes: [0, 0] })).toThrow(
    'MODEL_INVALID_EVIDENCE',
  );
  expect(() => validate({ ...decision, evidenceIndexes: [199] })).toThrow('MODEL_INVALID_EVIDENCE');
});

const model: RelevanceModel = async (input) => ({
  model: 'offline-field-rules',
  usage: null,
  output: {
    decisions: input.candidates.map((c) => ({
      key: c.key,
      status: assessSemanticCandidate(
        { item: c.item, purchase: c.purchase, evidence: c.evidence },
        input.conditions.map(({ concept, text, relation }) => ({ concept, text, relation })),
      ).decision!.status,
      evidenceIndexes: [0],
      reason: '离线边界测试',
    })),
  },
});
it.each([false, true])('FLOW-06 exposes only confirmed facts with privacy=%s', async (privacy) => {
  const fixture = frozenBusinessFixture();
  const ambiguous = fixture.materials.find((r) => r.name.includes('3mm绿松石圆珠'))!;
  ambiguous.notes = '材质待核对';
  const facts = createAssistantFacts({
    accountId: 'test',
    recall: (q) => readAssistantRecall(fixture.tx, q),
    purchases: (q) => readAssistantPurchases(fixture.tx, q),
    stock: (q) => readAssistantStock(fixture.tx, q),
    model,
    relevanceBudget: { batchSize: 50, maxCallsPerStep: 20, maxReservedTokens: 500000 },
  });
  const outcome = await facts(
    { query: semanticQuery, view: 'details' },
    null,
    new AbortController().signal,
    async () => {},
  );
  expect(outcome.status).toBe('needs_confirmation');
  const result = assistantResultView(outcome.result, privacy)!;
  expect(result.selectionIsPartial).toBe(true);
  expect(result.purchases).toHaveLength(10);
  expect(result.purchases.some((r) => r.item.id === ambiguous.id)).toBe(false);
  expect(result.summary!.totals.purchaseEntryCount).toBe(10);
  expect(result.summary!.totals.amounts).toEqual(
    privacy ? [] : [expect.objectContaining({ knownAmount: '1028.20' })],
  );
});

it('reuses unchanged semantic judgments while rereading changed amount and stock facts', async () => {
  const fixture = frozenBusinessFixture();
  let calls = 0;
  const adapter = createAssistantFacts({
    accountId: 'test',
    recall: (q) => readAssistantRecall(fixture.tx, q),
    purchases: (q) => readAssistantPurchases(fixture.tx, q),
    stock: (q) => readAssistantStock(fixture.tx, q),
    display: async () => [],
    model: async (...args) => {
      calls++;
      return model(...args);
    },
    relevanceBudget: { batchSize: 50, maxCallsPerStep: 20, maxReservedTokens: 500000 },
  });
  const state = { query: semanticQuery, view: 'details' as const };
  const first = await adapter(state, null, new AbortController().signal, async () => {});
  expect(first.status).toBe('completed');
  const firstCalls = calls;
  expect(firstCalls).toBeGreaterThan(0);
  const row = fixture.entries.find((r) => r.material.name === '3mm绿松石圆珠')!;
  // In-memory fixture only: no business database mutation.
  row.purchaseTotalAmount = new Prisma.Decimal('900.00');
  row.remainingQty = new Prisma.Decimal('0.25');
  const second = await adapter(
    state,
    first.checkpoint,
    new AbortController().signal,
    async () => {},
  );
  expect(second.status).toBe('completed');
  expect(calls).toBe(firstCalls);
  const result = assistantResultView(second.result, false)!;
  expect(result.summary!.totals.amounts[0].knownAmount).toBe('1928.20');
  expect(result.stock!.catalogStock.find((s) => s.item.id === row.materialId)?.knownStock).toBe(
    '0.25',
  );
});

it('reports successful business stages as completed rather than stopped', async () => {
  const fixture = frozenBusinessFixture();
  const result = await runAssistantLoop({
    execution: newAssistantExecution({ query: semanticQuery, view: 'details' }),
    text: '固定范围查询',
    model: async ({ name }) => ({
      id: 'mock',
      name,
      arguments: name === 'plan_query' ? '{"hard":{},"semantic":{},"clarification":null}' : '{}',
      model: 'mock',
      usage: null,
    }),
    facts: createAssistantFacts({
      accountId: 'test',
      recall: (q) => readAssistantRecall(fixture.tx, q),
      purchases: (q) => readAssistantPurchases(fixture.tx, q),
      stock: (q) => readAssistantStock(fixture.tx, q),
      model,
      relevanceBudget: { batchSize: 50, maxCallsPerStep: 20, maxReservedTokens: 500000 },
    }),
    save: async () => {},
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('completed');
  expect(result.trace.filter((e) => e.outcome !== 'success')).toEqual([]);
  expect(result.trace.some((e) => e.stage === 'candidate')).toBe(true);
});

it('invalidates semantic checkpoint reuse when the configured relevance model changes', async () => {
  vi.stubEnv('ASSISTANT_RELEVANCE_API_KEY', 'offline-test-key');
  vi.stubEnv('ASSISTANT_RELEVANCE_MODEL', 'model-a');
  try {
    const fixture = frozenBusinessFixture();
    const load = (q: typeof semanticQuery) => readAssistantRecall(fixture.tx, q);
    const first = new RelevanceRuns();
    const started = await first.start('a', semanticQuery, load);
    const evaluated = await first.advance(
      'a',
      { runId: started.runId, revision: 0, budget: { maxCallsPerStep: 20 } },
      model,
    );
    expect(evaluated.decisions.length).toBeGreaterThan(0);
    const checkpoint = first.checkpoint('a', started.runId);
    vi.stubEnv('ASSISTANT_RELEVANCE_MODEL', 'model-b');
    const restored = await new RelevanceRuns().start('a', semanticQuery, load, checkpoint);
    expect(restored.decisions).toEqual([]);
    expect(restored.usage.calls).toBe(evaluated.usage.calls);
    expect(restored.usage.reservedTokens).toBe(evaluated.usage.reservedTokens);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('projects purchase remaining per source identity and rejects product source stock', async () => {
  const f = frozenBusinessFixture();
  const row = f.entries[0];
  row.receivedQty = new Prisma.Decimal(10);
  row.remainingQty = new Prisma.Decimal(2);
  f.entries.push({ ...row, id: 'c0000000000000000000099999', remainingQty: new Prisma.Decimal(4) });
  const facts = createAssistantFacts({
    accountId: 'test',
    recall: (q) => readAssistantRecall(f.tx, q),
    purchases: (q) => readAssistantPurchases(f.tx, q),
    stock: (q) => readAssistantStock(f.tx, q),
    model,
  });
  const query = assistantQuerySchema.parse({
    ...semanticQuery,
    hard: { items: [{ type: 'MATERIAL', id: row.materialId }] },
    semantic: [],
  });
  const outcome = await facts(
    { query, view: 'purchase_remaining' },
    null,
    new AbortController().signal,
    async () => {},
  );
  expect(outcome.status).toBe('completed');
  const view = assistantResultView(outcome.result, false)!;
  expect(view.stockMode).toBe('purchase_remaining');
  expect(view.stock!.sourceStock.map((r) => r.remainingQuantity).sort()).toEqual(['2.00', '4.00']);
  expect(new Set(view.stock!.sourceStock.map((r) => r.purchase.id)).size).toBe(2);
  expect(
    assistantResultView(outcome.result, true)!.stock!.sourceStock.every((r) => r.name === ''),
  ).toBe(true);
  const product = await facts(
    { query: { ...query, itemTypes: ['PRODUCT'] }, view: 'purchase_remaining' },
    null,
    new AbortController().signal,
    async () => {},
  );
  expect(product.status).toBe('needs_confirmation');
  expect(product.result).toBeNull();
});

it('keeps uncertain-only location filters out of no_results and hides location free text', async () => {
  const f = frozenBusinessFixture();
  const resolution = resolveLocationRows({ text: '荔湾广场', kind: 'exact_place' }, f.distributors);
  const facts = createAssistantFacts({
    accountId: 'test',
    recall: (q) => readAssistantRecall(f.tx, q),
    purchases: (q) => readAssistantPurchases(f.tx, q),
    stock: (q) => readAssistantStock(f.tx, q),
    location: async () => resolution,
    model,
  });
  const query = assistantQuerySchema.parse({
    ...semanticQuery,
    hard: { location: resolution.query, distributorIds: [resolution.uncertain[0].distributor.id] },
    semantic: [],
  });
  const outcome = await facts(
    { query, view: 'distributors' },
    null,
    new AbortController().signal,
    async () => {},
  );
  expect(outcome.status).toBe('needs_confirmation');
  const view = assistantResultView(outcome.result, false)!;
  expect(view.distributors!.confirmed).toEqual([]);
  expect(view.distributors!.uncertain).toHaveLength(1);
  const privateView = assistantResultView(outcome.result, true)!;
  expect(privateView.distributors!.uncertain[0]).toMatchObject({
    name: '',
    area: '',
    evidence: [],
  });
  expect(JSON.stringify(privateView)).not.toContain('荔湾广场');
  expect(JSON.stringify(view)).not.toContain('address":');
});

it('binds the two explicit R08 stock follow-ups to the established selection', () => {
  const previous = { query: semanticQuery, view: 'details' as const };
  const wrong = {
    view: 'purchase_remaining' as const,
    hard: { location: null },
    semantic: { material: [] },
    month: 'previous_month' as const,
    clarification: null,
  };
  expect(normalizeAssistantFollowup(wrong, '这些还剩多少？', previous)).toEqual({
    hard: {},
    semantic: {},
    view: 'stock',
    clarification: null,
  });
  expect(
    normalizeAssistantFollowup({ ...wrong, view: 'stock' }, '这次买的还剩多少', previous).view,
  ).toBe('purchase_remaining');
  expect(normalizeAssistantFollowup(wrong, '这些还剩多少，同时改为上个月', previous)).toBe(wrong);
  expect(normalizeAssistantFollowup(wrong, '这些还剩多少', null)).toBe(wrong);
});

it('allows clearing an old date before applying a backend month while rejecting two explicit date operations', () => {
  const patch = {
    hard: { purchaseDate: null },
    semantic: {},
    month: 'this_month',
    clarification: null,
  };
  expect(planToolSchema.safeParse(patch).success).toBe(true);
  const state = applyAssistantPlan(
    { query: semanticQuery, view: 'details' },
    patch,
    new Date('2026-11-17T00:00:00Z'),
  );
  expect(state.query.hard.purchaseDate).toEqual({ from: '2026-11-01', to: '2026-12-01' });
  expect(
    planToolSchema.safeParse({
      ...patch,
      hard: { purchaseDate: { from: '2026-12-01', to: '2027-01-01' } },
    }).success,
  ).toBe(false);
});
