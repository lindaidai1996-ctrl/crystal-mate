// Offline assessment only: frozen data + saved model measurements, no DB/API.
import { readFile, writeFile } from 'node:fs/promises';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { semanticQuery } from '../tests/fixtures/ai-assistant-semantics';
import {
  boundaryCases,
  boundaryQuery,
  frozenEvaluationDetails,
  annotateEvaluationRecall,
} from '../tests/fixtures/ai-assistant-evaluation';
import { candidateKey, type AssistantQuery } from '../src/lib/ai-assistant/contracts';
import type { CandidateDetail } from '../src/lib/ai-assistant/candidate-contracts';
function recallMetrics(rows: CandidateDetail[], query: AssistantQuery, expected: Set<string>) {
  const start = performance.now();
  const snapshot = annotateEvaluationRecall(rows, query);
  const lexical = snapshot.data.sources
    .filter((s) => s.sources.some((route) => route.route !== 'full_scope'))
    .map((s) => s.key);
  const full = rows.map((r) => candidateKey(r.candidate));
  const metrics = (keys: string[]) => ({
    candidateCount: keys.length,
    missingExpected: [...expected].filter((key) => !keys.includes(key)),
    expectedIncludesRetained: keys.filter((key) => expected.has(key)).length,
    otherCandidates: keys.filter((key) => !expected.has(key)).length,
  });
  return {
    fullScope: metrics(full),
    lexicalUnion: metrics(lexical),
    sourceCounts: snapshot.data.sourceCounts,
    offlineAnnotationMs: performance.now() - start,
  };
}
async function main() {
  const reports = [];
  for (const suffix of [
    'frozen-real-core',
    'frozen-real-core-incomplete-evidence',
    'frozen-real-boundary',
    'dev-real',
  ]) {
    const file = `docs/plans/ai-assistant/verification/2026-11-16-p3-03-05-${suffix}.json`;
    const report = JSON.parse(await readFile(file, 'utf8'));
    reports.push({
      file,
      source: report.source,
      databaseReadMs: report.databaseReadMs ?? null,
      results: report.results.map(
        (r: {
          label: string;
          repetition: number;
          durationMs: number;
          usage: unknown;
          differences: unknown[];
          recall: number;
          precision: number;
        }) => ({
          label: r.label,
          repetition: r.repetition,
          durationMs: r.durationMs,
          usage: r.usage,
          differences: r.differences,
          recall: r.recall,
          precision: r.precision,
        }),
      ),
    });
  }
  const report = {
    checkedAt: new Date().toISOString(),
    decision: 'defer-semantic-index',
    frozen: recallMetrics(
      frozenEvaluationDetails,
      semanticQuery,
      new Set(
        frozenEvaluationDetails
          .filter((r) => baseline.goldenCase.includedEntryIds.includes(r.candidate.purchase!.id))
          .map((r) => candidateKey(r.candidate)),
      ),
    ),
    constructed: recallMetrics(
      boundaryCases.map((c) => c.detail),
      boundaryQuery,
      new Set(
        boundaryCases
          .filter((c) => c.expected === 'include')
          .map((c) => candidateKey(c.detail.candidate)),
      ),
    ),
    measurements: reports,
    vectorComparison: {
      implemented: false,
      missRate: null,
      falsePositiveRate: null,
      latencyMs: null,
      cost: null,
      reason:
        'No missed positive candidate in current full-scope or lexical union. No measured benefit justifies new index lifecycle/dependency; unknown metadata and field conflicts require evidence, not similarity guesses.',
    },
    limitations: [
      'Full scope deliberately retains semantic negatives/uncertain rows; otherCandidates is retrieval workload, not model false positives',
      'Offline annotation timing excludes database, network and model latency',
      'No vector implementation or comparative vector performance claim',
      '5000-row hard-scope cap remains; no large-scale benchmark',
      'Prompt token duplication is a measured optimization opportunity before adding an index',
      'Token costs recorded; monetary amount unknown without current billing/cache rates',
    ],
    reevaluateWhen: [
      'A reviewed positive with adequate stored evidence is missed after introducing a bounded lexical-only or staged retrieval path',
      'Typical hard scope exceeds 5000 or repeatedly exhausts execution budget',
      'Repeated 44-candidate queries exceed 15s p95 after prompt de-duplication; larger representative load tests needed',
      'Per-query token use/cost exceeds the business-defined budget after prompt compression/caching',
      'New synonym/long-text cases show incremental vector recall while preserving false-positive and uncertainty limits',
    ],
  };
  await writeFile(
    'docs/plans/ai-assistant/verification/2026-11-16-p3-05-index-assessment.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      decision: report.decision,
      frozen: report.frozen,
      constructed: report.constructed,
    }),
  );
}
void main();
