import { expect, it } from 'vitest';
import { minimizeAssistantText } from '@/lib/ai-assistant/conversation-store';
import {
  newAssistantExecution,
  runAssistantLoop,
  type TraceEvent,
} from '@/lib/ai-assistant/orchestrator';
import { createAssistantFacts } from '@/lib/ai-assistant/orchestration-facts';
import { CandidateQueryError } from '@/lib/ai-assistant/candidate-contracts';
import { semanticQuery } from '../fixtures/ai-assistant-semantics';

it('records rule/prompt/transport versions and a failed parse without arbitrary errors', async () => {
  const saves: unknown[] = [];
  const result = await runAssistantLoop({
    execution: newAssistantExecution(null),
    text: '合成查询',
    model: async () => {
      throw new Error('Bearer secret sk-secret123456 user@example.com');
    },
    facts: async () => {
      throw new Error('must not run');
    },
    save: async (data) => {
      saves.push(structuredClone(data));
    },
    signal: new AbortController().signal,
  });
  expect(result.metadata.ruleVersion).toBe('v1');
  expect(result.metadata.promptVersion).toBe('orchestration-v5');
  expect(result.metadata.relevancePromptVersion).toBe('relevance-v3');
  expect(result.trace[0]).toMatchObject({
    stage: 'parse',
    outcome: 'failed',
    code: 'MODEL_INVALID_RESPONSE',
    usage: null,
  });
  expect((saves[0] as typeof result).trace[0].outcome).toBe('started');
  expect(JSON.stringify(saves)).not.toMatch(/secret|example\.com/);
});
it('identifies candidate failures separately from judgments, with no fabricated facts', async () => {
  const events: TraceEvent[] = [];
  const facts = createAssistantFacts({
    accountId: 'a',
    recall: async () => {
      throw new CandidateQueryError('LOCATION_NEEDS_CLARIFICATION');
    },
    purchases: async () => {
      throw new Error('must not query');
    },
    stock: async () => {
      throw new Error('must not query');
    },
    model: async () => {
      throw new Error('must not call');
    },
  });
  const result = await facts(
    { query: semanticQuery, view: 'details' },
    null,
    new AbortController().signal,
    async (event) => {
      events.push(event);
    },
  );
  expect(result.status).toBe('needs_confirmation');
  expect(result.result).toBeNull();
  expect(events.at(-1)).toMatchObject({
    stage: 'candidate',
    outcome: 'failed',
    code: 'LOCATION_NEEDS_CLARIFICATION',
  });
});
it('minimizes common credentials, URLs, phone and email without changing decimal amounts or references', () => {
  expect(
    minimizeAssistantText(
      'Bearer xyz sk-abcde12345 https://private.test/x?q=secret 13800138000 user@example.com 1897.60 cm123abc',
    ),
  ).toBe('[credential] [credential] [url] [phone] [email] 1897.60 cm123abc');
});
