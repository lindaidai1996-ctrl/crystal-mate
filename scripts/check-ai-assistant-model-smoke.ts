// One compatibility call, constructed public vocabulary only; no database.
import { config } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { boundaryCases, boundaryQuery } from '../tests/fixtures/ai-assistant-evaluation';
import {
  relevanceCandidate,
  validateRelevanceOutput,
} from '../src/lib/ai-assistant/relevance-contracts';
import {
  buildRelevanceInput,
  judgeAssistantRelevance,
} from '../src/lib/ai-assistant/relevance-model';
config({ path: '.env' });
async function main() {
  const candidates = [boundaryCases[0], boundaryCases[3], boundaryCases[5]].map((c) =>
    relevanceCandidate(c.detail.candidate),
  );
  const started = Date.now();
  try {
    const result = await judgeAssistantRelevance(
      buildRelevanceInput(boundaryQuery, candidates, []),
      { signal: AbortSignal.timeout(30_000), maxOutputTokens: 1000 },
    );
    const decisions = validateRelevanceOutput(result.output, candidates, boundaryQuery.semantic);
    const report = {
      mode: 'real-model',
      snapshot: 'constructed-only',
      promptVersion: 'relevance-v1',
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      model: result.model,
      usage: result.usage,
      statuses: decisions.map((d) => d.status),
      calls: 1,
    };
    await writeFile(
      'docs/plans/ai-assistant/verification/2026-11-16-p3-model-smoke.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'MODEL_UNAVAILABLE');
    process.exitCode = 1;
  }
}
void main();
