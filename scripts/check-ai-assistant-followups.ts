// Three synthetic condition-only real calls. No business rows, identities or database.
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  type QueryState,
  planToolSchema,
  applyAssistantPlan,
} from '../src/lib/ai-assistant/orchestration-contracts';
import { ASSISTANT_SYSTEM_PROMPT } from '../src/lib/ai-assistant/orchestrator';
import { createAssistantToolModel } from '../src/lib/ai-assistant/orchestration-model';
import { semanticQuery } from '../tests/fixtures/ai-assistant-semantics';
dotenv.config({ quiet: true });
async function main() {
  if (!process.argv.includes('--real')) {
    console.log('Pass --real for three synthetic condition-only follow-up checks. No DB.');
    return;
  }
  const model = createAssistantToolModel();
  let state: QueryState = { query: semanticQuery, view: 'details' };
  const results: unknown[] = [];
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    kind: 'real-model-synthetic-followup-conditions-only',
    results,
    businessDataSent: false,
  };
  try {
    for (const text of ['只看圆珠', '按供应商汇总', '改为上个月']) {
      const before = structuredClone(state);
      const began = Date.now();
      const response = await model({
        name: 'plan_query',
        parameters: z.toJSONSchema(planToolSchema),
        signal: AbortSignal.timeout(30000),
        messages: [
          { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ text, previous: state }) },
        ],
      });
      const plan = planToolSchema.parse(JSON.parse(response.arguments));
      assert.equal(plan.clarification, null);
      state = applyAssistantPlan(state, plan, new Date('2026-11-17T02:00:00Z'));
      results.push({
        text,
        plan,
        state,
        model: response.model,
        usage: response.usage,
        durationMs: Date.now() - began,
      });
      assert.deepEqual(state.query.hard.location, before.query.hard.location);
      if (text === '只看圆珠') {
        assert(state.query.semantic.some((c) => c.concept === 'form' && c.text === '圆珠'));
        assert.deepEqual(
          state.query.semantic.filter((c) => c.concept !== 'form'),
          before.query.semantic,
        );
        assert.deepEqual(state.query.hard, before.query.hard);
      } else if (text === '按供应商汇总') {
        assert.deepEqual(state.query, before.query);
        assert.equal(state.view, 'by_distributor');
      } else {
        assert.deepEqual(state.query.hard.purchaseDate, { from: '2026-10-01', to: '2026-11-01' });
        assert.deepEqual(state.query.semantic, before.query.semantic);
        assert.equal(state.view, before.view);
      }
    }
    report.passed = true;
  } catch {
    report.passed = false;
    report.errorCode = 'FOLLOWUP_CHECK_FAILED';
    process.exitCode = 1;
  }
  const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p4-followups.json`;
  await writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ file, passed: report.passed }));
}
main().catch(() => {
  console.error('FOLLOWUP_SETUP_FAILED');
  process.exitCode = 1;
});
