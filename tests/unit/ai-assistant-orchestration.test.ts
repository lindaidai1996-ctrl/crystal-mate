import { describe, it, expect, vi } from 'vitest';
import { applyAssistantPlan } from '@/lib/ai-assistant/orchestration-contracts';
import { newAssistantExecution, runAssistantLoop } from '@/lib/ai-assistant/orchestrator';
import type { ToolModel } from '@/lib/ai-assistant/orchestration-model';
import { createAssistantToolModel } from '@/lib/ai-assistant/orchestration-model';
import { createAssistantFacts } from '@/lib/ai-assistant/orchestration-facts';
import { RelevanceRuns } from '@/lib/ai-assistant/relevance-runs';
import { semanticQuery } from '../fixtures/ai-assistant-semantics';
import {
  frozenEvaluationDetails,
  annotateEvaluationRecall,
} from '../fixtures/ai-assistant-evaluation';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import { assessSemanticCandidate } from '@/lib/ai-assistant/semantic-policy';
import { candidateKey } from '@/lib/ai-assistant/contracts';

const plan = { hard: {}, semantic: {}, clarification: null };
const toolModel = (patch: unknown = plan): ToolModel =>
  vi.fn(async ({ name }) => ({
    id: 'call-1',
    name,
    arguments: JSON.stringify(name === 'plan_query' ? patch : {}),
    model: 'synthetic',
    usage: { promptTokens: 10, completionTokens: 4 },
  }));
const facts = vi.fn(async () => ({
  status: 'completed' as const,
  result: { backendFact: true },
  checkpoint: null,
}));
const execute = (
  model = toolModel(),
  overrides: Partial<Parameters<typeof runAssistantLoop>[0]> = {},
) =>
  runAssistantLoop({
    execution: newAssistantExecution(null),
    text: '查采购',
    model,
    facts,
    save: async () => {},
    signal: new AbortController().signal,
    ...overrides,
  });

describe('controlled assistant loop', () => {
  it('forces registered stages and sends only a status receipt, not facts, back to the model', async () => {
    const model = toolModel();
    const result = await execute(model);
    expect(result.status).toBe('completed');
    expect(result.calls).toBe(3);
    expect(vi.mocked(model).mock.calls.map(([r]) => r.name)).toEqual([
      'plan_query',
      'query_facts',
      'finish',
    ]);
    expect(JSON.stringify(vi.mocked(model).mock.calls)).not.toContain('backendFact');
    expect(result.trace.every((e) => e.outcome === 'success')).toBe(true);
  });
  it.each([
    { ...plan, accountId: 'other' },
    { ...plan, sql: 'select 1' },
    { ...plan, hard: { ownerId: 'other' } },
    { ...plan, hard: { tagIds: [] } },
  ])('rejects forbidden or invalid arguments %j', async (patch) => {
    const business = vi.fn(facts);
    const result = await execute(toolModel(patch), { facts: business });
    expect(result.status).toBe('model_failed');
    expect(business).not.toHaveBeenCalled();
  });
  it('rejects unregistered tool and malformed output', async () => {
    const model: ToolModel = async () => ({
      id: 'x',
      name: 'sql',
      arguments: '{}',
      model: 'x',
      usage: null,
    });
    expect((await execute(model)).errorCode).toBe('TOOL_NOT_ALLOWED');
  });
  it('stops on clarification without issuing a query', async () => {
    const business = vi.fn(facts);
    const result = await execute(toolModel({ ...plan, clarification: '哪位采购人？' }), {
      facts: business,
    });
    expect(result.status).toBe('needs_confirmation');
    expect(business).not.toHaveBeenCalled();
  });
  it('reserves calls on failures and exposes exhaustion', async () => {
    expect((await execute(toolModel(), { budget: { maxCalls: 1 } })).status).toBe('budget');
    const result = await execute(async () => {
      throw new Error('secret https://private/token');
    });
    expect(result.calls).toBe(1);
    expect(result.reservedTokens).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('keeps query failure distinct from empty results', async () => {
    const result = await execute(toolModel(), {
      facts: async () => ({
        status: 'query_failed',
        result: null,
        checkpoint: null,
        errorCode: 'QUERY_FAILED',
      }),
    });
    expect(result.status).toBe('query_failed');
    expect(result.result).toBeNull();
  });
  it('times out an adapter that ignores the signal', async () => {
    const result = await execute(() => new Promise(() => {}), { budget: { callTimeoutMs: 5 } });
    expect(result.status).toBe('timeout');
  });
  it('validates actual fetch envelopes and forced single tool request', async () => {
    vi.stubEnv('ASSISTANT_API_KEY', 'test');
    try {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({
          model: 'test',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [
                  { id: 'call', type: 'function', function: { name: 'finish', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
      );
      await createAssistantToolModel(fetcher)({
        name: 'finish',
        parameters: { type: 'object' },
        messages: [],
        signal: new AbortController().signal,
      });
      const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
      expect(body.tool_choice.function.name).toBe('finish');
      expect(body.parallel_tool_calls).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('follow-up condition operations', () => {
  const previous = { query: semanticQuery, view: 'details' as const };
  it('retains material/purpose/location/date while replacing form', () => {
    const result = applyAssistantPlan(
      previous,
      { ...plan, semantic: { form: [{ concept: 'form', text: '圆珠', relation: 'is' }] } },
      new Date(),
    );
    expect(result.query.hard).toEqual(semanticQuery.hard);
    expect(result.query.semantic).toEqual([
      ...semanticQuery.semantic,
      { concept: 'form', text: '圆珠', relation: 'is' },
    ]);
  });
  it('changes only presentation for supplier grouping', () => {
    const result = applyAssistantPlan(previous, { ...plan, view: 'by_distributor' }, new Date());
    expect(result.query.hard).toEqual(previous.query.hard);
    expect(result.query.semantic).toEqual(previous.query.semantic);
    expect(result.view).toBe('by_distributor');
  });
  it('uses Shanghai month/year boundaries and explicitly deletes conditions', () => {
    const result = applyAssistantPlan(
      previous,
      { ...plan, month: 'previous_month', hard: { location: null }, semantic: { purpose: [] } },
      new Date('2026-12-31T16:00:00Z'),
    );
    expect(result.query.hard.purchaseDate).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(result.query.hard.location).toBeUndefined();
    expect(result.query.semantic.every((c) => c.concept !== 'purpose')).toBe(true);
  });
});

describe('P2/P3 fact adapter', () => {
  const recall = async () => annotateEvaluationRecall(frozenEvaluationDetails, semanticQuery);
  const judge: Parameters<RelevanceRuns['advance']>[2] = async (input) => ({
    model: 'rule-mock',
    usage: { promptTokens: 10, completionTokens: 20 },
    output: {
      decisions: input.candidates.map((c) => {
        const candidate = frozenEvaluationDetails.find(
          (d) => candidateKey(d.candidate) === c.key,
        )!.candidate;
        const decision = assessSemanticCandidate(candidate, semanticQuery.semantic).decision!;
        return {
          key: c.key,
          status: decision.status,
          evidenceIndexes: decision.evidence
            .map((e) =>
              c.evidence.findIndex((actual) => JSON.stringify(e) === JSON.stringify(actual)),
            )
            .filter((i) => i >= 0),
          reason: '真实字段证据（mock）',
        };
      }),
    },
  });
  it('finishes frozen main-case selection through P3 and passes exact backend identities to P2', async () => {
    const purchases = vi.fn(
      async (input: import('@/lib/ai-assistant/purchase-contracts').PurchaseQuery) => ({
        rows: [],
        candidates: [],
        scopeCandidateCount: input.query.subject === 'purchases' ? 44 : 0,
      }),
    );
    const adapter = createAssistantFacts({
      accountId: 'account-a',
      recall,
      purchases,
      stock: vi.fn(),
      model: judge,
      relevanceBudget: { batchSize: 50, maxCallsPerStep: 20, maxReservedTokens: 500000 },
    });
    const result = await adapter(
      { query: semanticQuery, view: 'details' },
      null,
      new AbortController().signal,
      async () => {},
    );
    expect(result.status).toBe('completed');
    expect(purchases.mock.calls[0][0].selectedPurchases!.map((r) => r.id).sort()).toEqual(
      [...baseline.goldenCase.includedEntryIds].sort(),
    );
  });
  it('continues a persisted checkpoint in a fresh process-local executor without resetting costs', async () => {
    const first = new RelevanceRuns();
    const started = await first.start('a', semanticQuery, recall);
    const partial = await first.advance(
      'a',
      {
        runId: started.runId,
        revision: 0,
        budget: { batchSize: 10, maxCallsPerStep: 1, maxReservedTokens: 500000 },
      },
      judge,
    );
    const checkpoint = first.checkpoint('a', started.runId);
    const second = new RelevanceRuns();
    const restored = await second.start('a', semanticQuery, recall, checkpoint);
    expect(restored.usage.calls).toBe(1);
    expect(restored.decisions).toEqual(partial.decisions);
    const complete = await second.advance(
      'a',
      {
        runId: restored.runId,
        revision: 0,
        budget: { batchSize: 50, maxCallsPerStep: 20, maxReservedTokens: 500000 },
      },
      judge,
    );
    expect(complete.completeness.evaluation).toBe('complete');
    expect(complete.usage.calls).toBeGreaterThan(1);
    expect(complete.attempts.flatMap((a) => a.keys)).toHaveLength(44);
  });
  it('invalidates judgments when re-read evidence changes but retains spent budget', async () => {
    const first = new RelevanceRuns();
    const started = await first.start('a', semanticQuery, recall);
    await first.advance('a', { runId: started.runId, revision: 0 }, judge);
    const checkpoint = first.checkpoint('a', started.runId);
    const second = new RelevanceRuns();
    const restored = await second.start(
      'a',
      semanticQuery,
      async () => {
        const source = structuredClone(await recall());
        source.rows[0].candidate.evidence[0].value = 'changed';
        return source;
      },
      checkpoint,
    );
    expect(restored.decisions).toHaveLength(0);
    expect(restored.usage.calls).toBe(checkpoint.attempts.length);
  });
});
