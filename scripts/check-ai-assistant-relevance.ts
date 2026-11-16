import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { semanticQuery } from '../tests/fixtures/ai-assistant-semantics';
import {
  boundaryCases,
  boundaryQuery,
  frozenEvaluationDetails,
  annotateEvaluationRecall,
} from '../tests/fixtures/ai-assistant-evaluation';
import { candidateKey, type AssistantQuery } from '../src/lib/ai-assistant/contracts';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { RelevanceRuns } from '../src/lib/ai-assistant/relevance-runs';
import {
  judgeAssistantRelevance,
  type RelevanceModel,
} from '../src/lib/ai-assistant/relevance-model';
import { executionBudgetSchema } from '../src/lib/ai-assistant/relevance-contracts';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { summarizeAssistantPurchases } from '../src/lib/ai-assistant/purchase-summary';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import type { CandidateDetail } from '../src/lib/ai-assistant/candidate-contracts';

config({ path: '.env' });
const real = process.argv.includes('--real');
const dev = process.argv.includes('--dev');
const onlyCore = process.argv.includes('--only-core');
const onlyBoundary = process.argv.includes('--only-boundary');
const budget = executionBudgetSchema.parse({
  batchSize: 50,
  maxCallsPerStep: 2,
  maxCalls: 8,
  maxReservedTokens: 500_000,
  maxInputBytes: 300_000,
  maxOutputTokens: 8000,
  callTimeoutMs: 60_000,
  stepTimeoutMs: 120_000,
});
const mock: RelevanceModel = async (input) => ({
  model: 'mock-deterministic-rule-adapter',
  usage: null,
  output: {
    decisions: input.candidates.map((c) => ({
      key: c.key,
      status: c.ruleAssessment.decision?.status ?? 'uncertain',
      evidenceIndexes: [0],
      reason: 'Mock only; not real model validation',
    })),
  },
});
async function evaluate(
  label: string,
  query: AssistantQuery,
  rows: CandidateDetail[],
  expected: Map<string, string>,
  repetitions: number,
) {
  const results = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    const started = Date.now();
    const runs = new RelevanceRuns();
    let run = await runs.start(
      'read-only-verification',
      { ...query, pagination: { limit: 100 } },
      async (q) => annotateEvaluationRecall(structuredClone(rows), q),
    );
    for (let step = 0; step < 8 && run.completeness.evaluation !== 'complete'; step++) {
      run = await runs.advance(
        'read-only-verification',
        { runId: run.runId, revision: run.revision, budget },
        real ? judgeAssistantRelevance : mock,
      );
      // Preserve failures; no automatic retry until a lucky success hides them.
      if (run.completeness.stopReason !== 'budget' && run.completeness.stopReason !== null) break;
    }
    const actual = new Map(run.decisions.map((d) => [candidateKey(d), d.status]));
    const differences = [...expected]
      .filter(([key, status]) => actual.get(key) !== status)
      .map(([key, expected]) => ({ key, expected, actual: actual.get(key) ?? 'not_evaluated' }));
    const unreviewedKeys = rows
      .map((r) => candidateKey(r.candidate))
      .filter((key) => !expected.has(key));
    const expectedInclude = [...expected].filter(([, s]) => s === 'include').map(([k]) => k);
    const actualInclude = [...actual].filter(([, s]) => s === 'include').map(([k]) => k);
    const missing = expectedInclude.filter((k) => !actualInclude.includes(k));
    const extra = actualInclude.filter((k) => expected.has(k) && !expectedInclude.includes(k));
    const result = {
      label,
      repetition,
      mode: real ? 'real-model' : 'mock',
      inputCandidateCount: rows.length,
      durationMs: Date.now() - started,
      completeness: run.completeness,
      usage: run.usage,
      attempts: run.attempts,
      differences,
      unreviewedKeys,
      missingIncludes: missing,
      extraIncludes: extra,
      recall: expectedInclude.length
        ? (expectedInclude.length - missing.length) / expectedInclude.length
        : null,
      precision: actualInclude.length
        ? (actualInclude.length - extra.length) / actualInclude.length
        : null,
      decisions: run.decisions.map((d) => ({
        key: candidateKey(d),
        status: d.status,
        reason: d.reason,
        evidence: d.evidence.map((e) => ({ entity: e.entity, field: e.field })),
      })),
      passed:
        differences.length === 0 &&
        unreviewedKeys.length === 0 &&
        run.completeness.evaluation === 'complete',
    };
    results.push(result);
    console.log(
      JSON.stringify({
        label,
        repetition,
        mode: result.mode,
        durationMs: result.durationMs,
        calls: run.usage.calls,
        differences: differences.length,
        stopReason: run.completeness.stopReason,
        passed: result.passed,
      }),
    );
  }
  return results;
}
async function main() {
  let rows = structuredClone(frozenEvaluationDetails);
  let observed: unknown = null;
  const databaseStarted = Date.now();
  let databaseReadMs: number | null = null;
  if (dev) {
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      const url = new URL(process.env[key] ?? '');
      assert(
        url.protocol === 'postgresql:' &&
          url.hostname === '127.0.0.1' &&
          url.port === '15432' &&
          url.pathname === '/crystal_mate_dev' &&
          url.username === 'crystal_dev',
        'Requires isolated development database',
      );
    }
    const client = new PrismaClient({ log: [] });
    try {
      const snapshot = await client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
          const [target] = await tx.$queryRaw<
            { database: string; username: string; read_only: string }[]
          >`SELECT current_database() AS database,current_user AS username,current_setting('transaction_read_only') AS read_only`;
          assert(
            target.database === 'crystal_mate_dev' &&
              target.username === 'crystal_dev' &&
              target.read_only === 'on',
          );
          return readAssistantRecall(tx, semanticQuery);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
      );
      rows = snapshot.rows;
      const ids = rows.map((r) => r.candidate.purchase!.id);
      observed = {
        database: 'crystal_mate_dev',
        readOnly: true,
        frozenMissing: baseline.scopedCandidates.map((r) => r.id).filter((id) => !ids.includes(id)),
        added: ids.filter((id) => !baseline.scopedCandidates.some((r) => r.id === id)),
        sourceCounts: snapshot.data.sourceCounts,
      };
    } finally {
      await client.$disconnect();
    }
  }
  if (dev) databaseReadMs = Date.now() - databaseStarted;
  const expected = new Map(
    rows
      .filter(
        (r) => !dev || baseline.scopedCandidates.some((b) => b.id === r.candidate.purchase!.id),
      )
      .map((r) => [
        candidateKey(r.candidate),
        baseline.goldenCase.includedEntryIds.includes(r.candidate.purchase!.id)
          ? 'include'
          : 'exclude',
      ]),
  );
  const results = onlyBoundary
    ? []
    : await evaluate(
        dev ? 'development-read-only-core' : 'frozen-core',
        semanticQuery,
        rows,
        expected,
        dev ? 1 : 3,
      );
  if (!dev && !onlyCore) {
    results.push(
      ...(await evaluate(
        'constructed-boundaries',
        boundaryQuery,
        boundaryCases.map((c) => c.detail),
        new Map(boundaryCases.map((c) => [candidateKey(c.detail.candidate), c.expected])),
        3,
      )),
    );
    const usage = boundaryCases[7].detail;
    const usageQuery = {
      ...boundaryQuery,
      semantic: [
        { concept: 'material' as const, text: '绿松石', relation: 'used_with' as const },
        boundaryQuery.semantic[1],
      ],
    };
    results.push(
      ...(await evaluate(
        'SEM-09-used-with',
        usageQuery,
        [usage],
        new Map([[candidateKey(usage.candidate), 'include']]),
        1,
      )),
    );
  }
  const backendFacts = [];
  if (dev) {
    // Model execution is over; read live facts again in a new bounded read-only
    // transaction. Never keep a database transaction open across a model call.
    const client = new PrismaClient({ log: [] });
    try {
      for (const result of results) {
        if (result.completeness.evaluation !== 'complete') {
          backendFacts.push({ skipped: 'incomplete_semantic_evaluation' });
          continue;
        }
        try {
          const included = new Set(
            result.decisions.filter((d) => d.status === 'include').map((d) => d.key),
          );
          const selectedPurchases = rows
            .filter((r) => included.has(candidateKey(r.candidate)))
            .map((r) => r.candidate.purchase!);
          const facts = await client.$transaction(
            async (tx) => {
              await tx.$executeRaw`SET TRANSACTION READ ONLY`;
              await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
              const purchases = await readAssistantPurchases(tx, {
                query: semanticQuery,
                selectedPurchases,
              });
              const summary = summarizeAssistantPurchases(
                purchases.rows,
                purchases.scopeCandidateCount,
                'selected_purchases',
              );
              const stock = await readAssistantStock(tx, {
                mode: 'catalog_current',
                query: semanticQuery,
                selectedPurchases,
              });
              assert.equal(summary.totals.purchaseEntryCount, selectedPurchases.length);
              assert.equal(stock.selectedCandidateCount, selectedPurchases.length);
              if (result.passed) {
                assert.equal(
                  summary.totals.amounts.find((a) => a.currency === 'CNY')?.knownAmount,
                  '1897.60',
                );
                assert.deepEqual(
                  summary.totals.quantities.map((q) => [q.unit, q.knownQuantity]),
                  [
                    ['BEAD', '7.00'],
                    ['GRAM', '4.43'],
                    ['STRAND', '3.00'],
                  ],
                );
              }
              return {
                observedAt: new Date().toISOString(),
                selectedPurchaseCount: selectedPurchases.length,
                summary,
                stock,
              };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
          );
          backendFacts.push({ ...facts, selectionIsPartial: result.completeness.uncertain > 0 });
        } catch (error) {
          backendFacts.push({
            failed: true,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          process.exitCode = 1;
        }
      }
    } finally {
      await client.$disconnect();
    }
  }
  const report = {
    checkedAt: new Date().toISOString(),
    source: dev ? 'development-read-only' : 'frozen-and-constructed',
    mode: real ? 'real-model' : 'mock',
    inputAdapterVersion: 'frozen-parent-graph-v1',
    promptVersion: 'relevance-v1',
    ruleVersion: 'v1',
    adapter: 'native-fetch-json-no-tools',
    parameters: { temperature: 0, stream: false, ...budget },
    observed,
    databaseReadMs,
    backendFacts,
    results,
    limitations: [
      'Not authenticated HTTP, P4 tool/stream/multiturn or UI validation',
      'No production access, business writes, migration or deployment',
      'Mock is deterministic and not model validation',
      'Bounded full-scope fallback; >5000 rows fail explicitly',
      'Usage tokens are actual provider units when present; monetary cost needs current billing rates',
    ],
  };
  const suffix = `${dev ? 'dev' : 'frozen'}-${real ? 'real' : 'mock'}${onlyCore ? '-core' : onlyBoundary ? '-boundary' : ''}`;
  await writeFile(
    new URL(
      `../docs/plans/ai-assistant/verification/2026-11-16-p3-03-05-${suffix}.json`,
      import.meta.url,
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
void main().catch(async (error) => {
  // No upstream bodies, prompts, URLs or credentials in failure messages.
  console.error(
    'Relevance verification stopped:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
