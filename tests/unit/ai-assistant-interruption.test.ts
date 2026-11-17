import { expect, it, vi } from 'vitest';
import { CandidateQueryError } from '@/lib/ai-assistant/candidate-contracts';
import {
  newAssistantExecution,
  runAssistantLoop,
  type Execution,
  type FactExecutor,
} from '@/lib/ai-assistant/orchestrator';
import type { ToolModel, ToolResponse } from '@/lib/ai-assistant/orchestration-model';
import { createAssistantFacts } from '@/lib/ai-assistant/orchestration-facts';
import { semanticQuery } from '../fixtures/ai-assistant-semantics';
import { RelevanceRuns } from '@/lib/ai-assistant/relevance-runs';
import {
  annotateEvaluationRecall,
  frozenEvaluationDetails,
} from '../fixtures/ai-assistant-evaluation';
const response = (name: string): ToolResponse => ({
  id: 'call',
  name,
  arguments: JSON.stringify(
    name === 'plan_query' ? { hard: {}, semantic: {}, clarification: null } : {},
  ),
  model: 'mock',
  usage: null,
});
const model: ToolModel = async ({ name }) => response(name);
const goodFacts: FactExecutor = async () => ({
  status: 'completed',
  result: { backend: true },
  checkpoint: null,
});
const run = (overrides: Partial<Parameters<typeof runAssistantLoop>[0]> = {}) =>
  runAssistantLoop({
    execution: newAssistantExecution(null),
    text: 'synthetic',
    model,
    facts: goodFacts,
    save: async () => {},
    signal: new AbortController().signal,
    ...overrides,
  });

it.each([
  'no_results',
  'needs_confirmation',
  'query_failed',
  'model_failed',
  'incomplete',
  'budget',
  'timeout',
  'cancelled',
] as const)('preserves %s without converting it into a successful zero fact', async (status) => {
  const result = await run({
    facts: async () => ({
      status,
      result: status === 'no_results' ? { verifiedEmpty: true } : null,
      checkpoint: null,
    }),
  });
  expect(result.status).toBe(status);
  if (status !== 'no_results') expect(result.result).toBeNull();
});
it('cancels an ignored-signal model and rejects late response mutation', async () => {
  const controller = new AbortController();
  let resolve!: (response: ToolResponse) => void;
  const slow: ToolModel = () =>
    new Promise((done) => {
      resolve = done;
    });
  const saves: Execution[] = [];
  const promise = run({
    model: slow,
    signal: controller.signal,
    save: async (data) => {
      saves.push(structuredClone(data));
    },
  });
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  controller.abort();
  const cancelled = await promise;
  expect(cancelled.status).toBe('cancelled');
  const count = saves.length;
  resolve(response('plan_query'));
  await Promise.resolve();
  expect(saves).toHaveLength(count);
  expect(cancelled.state).toBeNull();
});
it('rejects late fact progress callbacks after a timeout', async () => {
  let progress!: Parameters<FactExecutor>[3];
  const saves: Execution[] = [];
  const result = await run({
    facts: async (_state, _checkpoint, _signal, event) => {
      progress = event;
      return new Promise(() => {});
    },
    budget: { timeoutMs: 10 },
    save: async (data) => {
      saves.push(structuredClone(data));
    },
  });
  expect(result.status).toBe('timeout');
  const count = saves.length;
  await expect(
    progress(
      {
        stage: 'facts',
        outcome: 'success',
        durationMs: 1,
        code: null,
        model: null,
        usage: null,
        completeness: null,
      },
      { stale: true },
    ),
  ).rejects.toThrow('STALE_EXECUTION_CALLBACK');
  expect(saves).toHaveLength(count);
  expect(result.checkpoint).toBeNull();
});
it('retries a failed phase with cumulative reservations and no hidden automatic retry', async () => {
  const flaky = vi
    .fn<ToolModel>()
    .mockRejectedValueOnce(new CandidateQueryError('MODEL_RATE_LIMIT'))
    .mockImplementation(model);
  const first = await run({ model: flaky });
  expect(first.status).toBe('model_failed');
  expect(first.calls).toBe(1);
  expect(flaky).toHaveBeenCalledTimes(1);
  const next = await run({ execution: first, model: flaky });
  expect(next.status).toBe('completed');
  expect(next.calls).toBe(4);
  expect(next.reservedTokens).toBeGreaterThan(first.reservedTokens);
});
it.each([
  ['LOCATION_NEEDS_CLARIFICATION', 'needs_confirmation'],
  ['LOCATION_INCOMPLETE', 'incomplete'],
  ['CANDIDATE_BUDGET_EXCEEDED', 'budget'],
  ['REFERENCE_NOT_FOUND', 'query_failed'],
] as const)('maps candidate %s accurately', async (code, expected) => {
  const facts = createAssistantFacts({
    accountId: 'a',
    recall: async () => {
      throw new CandidateQueryError(code);
    },
    purchases: vi.fn(),
    stock: vi.fn(),
    model: vi.fn(),
  });
  const outcome = await facts(
    { query: semanticQuery, view: 'details' },
    null,
    new AbortController().signal,
    async () => {},
  );
  expect(outcome.status).toBe(expected);
  expect(outcome.result).toBeNull();
});
it('persists relevance call reservations before a model request, including failed usage', async () => {
  const runs = new RelevanceRuns();
  const started = await runs.start('a', semanticQuery, async () =>
    annotateEvaluationRecall(frozenEvaluationDetails, semanticQuery),
  );
  const checkpoints: unknown[] = [];
  const judge = vi.fn(async () => {
    expect(checkpoints).toHaveLength(1);
    throw new CandidateQueryError('MODEL_RATE_LIMIT');
  });
  const result = await runs.advance(
    'a',
    { runId: started.runId, revision: 0 },
    judge,
    async (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  );
  expect(result.completeness.stopReason).toBe('model_failed');
  expect(result.usage.calls).toBe(1);
  expect(result.usage.unknownUsageCalls).toBe(1);
  expect(result.usage.reservedTokens).toBeGreaterThan(0);
  expect(checkpoints).toHaveLength(2);
});
