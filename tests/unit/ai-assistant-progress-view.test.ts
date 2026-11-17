import { resolveLocationRows } from '@/lib/ai-assistant/reference-resolution';
import { frozenBusinessFixture } from '../../scripts/lib/assistant-acceptance-fixture';
import { expect, it } from 'vitest';
import { newAssistantExecution } from '@/lib/ai-assistant/orchestrator';
import { assistantProgressView } from '@/lib/ai-assistant/progress-view';
import { semanticQuery } from '../fixtures/ai-assistant-semantics';
const item = { type: 'MATERIAL' as const, id: `c${'1'.repeat(24)}` };
const decision = {
  item,
  purchase: { type: 'MATERIAL_PURCHASE' as const, id: `c${'2'.repeat(24)}` },
  status: 'uncertain' as const,
  ruleVersion: 'v1' as const,
  reason: 'cost 123.45',
  evidence: [{ entity: item, field: 'name' as const, value: 'cost 123.45' }],
};
it('does not turn unknown candidate/evaluation counts into zero on query/model failure', () => {
  for (const status of [
    'query_failed',
    'model_failed',
    'timeout',
    'budget',
    'cancelled',
  ] as const) {
    const execution = newAssistantExecution(null);
    execution.status = status;
    const value = assistantProgressView(execution, false);
    expect(value.totalCandidates).toBeNull();
    expect(value.included).toBeNull();
    expect(value.evaluatedCandidates).toBeNull();
  }
});
it('projects actual checkpoint coverage, uncertainty and cumulative costs without exposing checkpoint internals', () => {
  const execution = newAssistantExecution({ query: semanticQuery, view: 'details' });
  execution.status = 'budget';
  execution.calls = 2;
  execution.reservedTokens = 200;
  execution.checkpoint = {
    fingerprint: 'private-fingerprint',
    decisions: [decision],
    attempts: [{ ignored: true }],
    reservedTokens: 300,
  };
  execution.trace = [
    {
      stage: 'candidate',
      outcome: 'success',
      durationMs: 1,
      code: null,
      model: null,
      usage: null,
      completeness: { totalCandidates: 100, readCandidates: 100 },
    },
  ];
  const value = assistantProgressView(execution, false);
  expect(value).toMatchObject({
    totalCandidates: 100,
    readCandidates: 100,
    evaluatedCandidates: 1,
    uncertain: 1,
    notEvaluated: 99,
    unreadCandidates: 0,
    evaluation: 'partial',
    calls: 2,
    reservedTokens: 200,
    relevanceCalls: 1,
    relevanceReservedTokens: 300,
  });
  const privateView = assistantProgressView(execution, true);
  expect(privateView.decisions[0]).toMatchObject({ name: null, reason: null, evidence: [] });
  expect(JSON.stringify(privateView)).not.toContain('123.45');
  expect(JSON.stringify(privateView)).not.toContain('private-fingerprint');
});
it('distinguishes a completed query with no semantic filter from evaluated semantics', () => {
  const execution = newAssistantExecution({
    query: { ...semanticQuery, semantic: [] },
    view: 'details',
  });
  execution.status = 'no_results';
  execution.trace = [
    {
      stage: 'candidate',
      outcome: 'success',
      durationMs: 1,
      code: null,
      model: null,
      usage: null,
      completeness: { totalCandidates: 0, readCandidates: 0 },
    },
  ];
  expect(assistantProgressView(execution, false)).toMatchObject({
    totalCandidates: 0,
    readCandidates: 0,
    included: 0,
    evaluation: 'not_required',
    traversal: 'complete',
  });
});

it('reports actual completed distributor scans and uncertain matches using distributor count basis', () => {
  const fixture = frozenBusinessFixture();
  const resolution = resolveLocationRows(
    { text: '荔湾广场', kind: 'exact_place' },
    fixture.distributors,
  );
  const execution = newAssistantExecution({
    query: { ...semanticQuery, hard: { location: resolution.query }, semantic: [] },
    view: 'distributors',
  });
  execution.status = 'needs_confirmation';
  execution.result = { facts: { kind: 'distributors', resolution } };
  expect(assistantProgressView(execution, true)).toMatchObject({
    countBasis: 'distributor',
    totalCandidates: fixture.distributors.length,
    readCandidates: fixture.distributors.length,
    included: 7,
    uncertain: 2,
    notEvaluated: 0,
    unreadCandidates: 0,
    traversal: 'complete',
    evaluation: 'not_required',
  });
});
