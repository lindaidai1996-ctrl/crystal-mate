// P6 fixed acceptance. --real explicitly enables billed model calls; no database.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { frozenBusinessFixture } from './lib/assistant-acceptance-fixture';
import {
  boundaryCases,
  boundaryQuery,
  annotateEvaluationRecall,
} from '../tests/fixtures/ai-assistant-evaluation';
import { semanticQuery, fixtureId } from '../tests/fixtures/ai-assistant-semantics';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import { summarizeAssistantPurchases } from '../src/lib/ai-assistant/purchase-summary';
import { PurchaseRuns } from '../src/lib/ai-assistant/purchase-runs';
import { resolveLocationRows } from '../src/lib/ai-assistant/reference-resolution';
import { RELEVANCE_PROMPT_VERSION } from '../src/lib/ai-assistant/relevance-contracts';
import { RelevanceRuns } from '../src/lib/ai-assistant/relevance-runs';
import { createAssistantFacts } from '../src/lib/ai-assistant/orchestration-facts';
import {
  createAssistantToolModel,
  type ToolModel,
} from '../src/lib/ai-assistant/orchestration-model';
import {
  judgeAssistantRelevance,
  type RelevanceModel,
} from '../src/lib/ai-assistant/relevance-model';
import { assessSemanticCandidate } from '../src/lib/ai-assistant/semantic-policy';
import {
  runAssistantLoop,
  newAssistantExecution,
  ASSISTANT_SYSTEM_PROMPT,
  type Execution,
} from '../src/lib/ai-assistant/orchestrator';
import {
  ORCHESTRATION_VERSION,
  applyAssistantPlan,
  planToolSchema,
  type QueryState,
} from '../src/lib/ai-assistant/orchestration-contracts';
import {
  candidateKey,
  assistantQuerySchema,
  decisionsForCandidatesSchema,
} from '../src/lib/ai-assistant/contracts';
import { assistantResultView } from '../src/lib/ai-assistant/result-view';

dotenv.config({ quiet: true });
const real = process.argv.includes('--real');
const only = process.argv
  .find((v) => v.startsWith('--only='))
  ?.slice(7)
  .split(',');
const now = new Date(baseline.scope.referenceNow);
const results: Record<string, unknown>[] = [];
const calls: Record<string, unknown>[] = [];
const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p6-fixed-${real ? 'real' : 'mock'}.json`;
const judge: RelevanceModel = async (input, options) => {
  const started = Date.now();
  const row: Record<string, unknown> = {
    kind: 'relevance',
    candidates: input.candidates.length,
    usage: null,
  };
  calls.push(row);
  try {
    const response = real
      ? await judgeAssistantRelevance(input, options)
      : {
          model: 'mock-field-rules',
          usage: null,
          output: {
            decisions: input.candidates.map((c) => {
              const decision = assessSemanticCandidate(
                { item: c.item, purchase: c.purchase, evidence: c.evidence },
                input.conditions.map(({ concept, text, relation }) => ({
                  concept,
                  text,
                  relation,
                })),
              ).decision!;
              return {
                key: c.key,
                status: decision.status,
                evidenceIndexes: decision.evidence.map((e) =>
                  c.evidence.findIndex((v) => JSON.stringify(v) === JSON.stringify(e)),
                ),
                reason: '离线字段规则验证',
              };
            }),
          },
        };
    Object.assign(row, { model: response.model, usage: response.usage, outcome: 'returned' });
    return response;
  } catch (error) {
    row.outcome = 'failed';
    throw error;
  } finally {
    row.durationMs = Date.now() - started;
  }
};
const realTool = createAssistantToolModel();
function tool(patch: unknown): ToolModel {
  return async (input) => {
    const started = Date.now();
    const row: Record<string, unknown> = { kind: input.name, usage: null };
    calls.push(row);
    try {
      const response = real
        ? await realTool(input)
        : {
            id: randomUUID(),
            name: input.name,
            arguments: JSON.stringify(input.name === 'plan_query' ? patch : {}),
            model: 'mock-plan',
            usage: null,
          };
      Object.assign(row, { model: response.model, usage: response.usage, outcome: 'returned' });
      if (input.name === 'plan_query') {
        const plan: unknown = JSON.parse(response.arguments);
        const parsed = planToolSchema.safeParse(plan);
        row.planValidation = parsed.success
          ? 'valid'
          : parsed.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
        const shape = z
          .object({
            month: z.unknown().optional(),
            hard: z.record(z.string(), z.unknown()).optional(),
            view: z.unknown().optional(),
            subject: z.unknown().optional(),
          })
          .safeParse(plan);
        if (shape.success)
          row.planShape = {
            month: shape.data.month,
            hardKeys: Object.keys(shape.data.hard ?? {}),
            purchaseDateIsNull: shape.data.hard?.purchaseDate === null,
            view: shape.data.view,
            subject: shape.data.subject,
          };
      }
      return response;
    } catch (error) {
      row.outcome = 'failed';
      throw error;
    } finally {
      row.durationMs = Date.now() - started;
    }
  };
}
const mainPatch = {
  subject: 'purchases',
  itemTypes: ['MATERIAL'],
  hard: { location: { text: '荔湾广场', kind: 'exact_place' } },
  month: 'this_month',
  semantic: { material: [semanticQuery.semantic[0]], purpose: [semanticQuery.semantic[1]] },
  clarification: null,
};
const fixture = frozenBusinessFixture();
const adapter = (extra: Partial<Parameters<typeof createAssistantFacts>[0]> = {}) =>
  createAssistantFacts({
    accountId: 'p6-frozen',
    recall: (q) => readAssistantRecall(fixture.tx, q),
    purchases: (q) => readAssistantPurchases(fixture.tx, q),
    stock: (q) => readAssistantStock(fixture.tx, q),
    model: judge,
    location: async (q) => resolveLocationRows(q, fixture.distributors),
    relevanceBudget: {
      batchSize: 50,
      maxCallsPerStep: 20,
      maxInputBytes: 300000,
      maxReservedTokens: 500000,
      maxOutputTokens: 8000,
      callTimeoutMs: 60000,
      stepTimeoutMs: 120000,
    },
    ...extra,
  });
async function loop(
  text: string,
  patch: unknown,
  previous: QueryState | null = null,
  facts = adapter(),
) {
  return runAssistantLoop({
    execution: newAssistantExecution(previous),
    text,
    model: tool(patch),
    facts,
    save: async () => {},
    signal: new AbortController().signal,
    now: () => now,
    budget: { timeoutMs: 120000, callTimeoutMs: 60000 },
  });
}
type Facts = Awaited<ReturnType<typeof readAssistantPurchases>> & {
  summary: ReturnType<typeof summarizeAssistantPurchases>;
  items: Awaited<ReturnType<typeof readAssistantPurchases>>['rows'];
};
function verify(execution: Execution, ids: string[], amount: string) {
  assert.equal(execution.status, 'completed');
  const result = execution.result as {
    facts: Facts;
    relevance: { completeness: { evaluation: string; uncertain: number }; decisions: unknown[] };
  };
  assert.equal(result.relevance.completeness.evaluation, 'complete');
  assert.equal(result.relevance.completeness.uncertain, 0);
  assert.deepEqual(result.facts.items.map((r) => r.purchase.id).sort(), [...ids].sort());
  assert.equal(result.facts.summary.totals.amounts[0]?.knownAmount, amount);
  return {
    selectedIds: result.facts.items.map((r) => r.purchase.id),
    summary: result.facts.summary,
    completeness: result.relevance.completeness,
    recall: 1,
    precision: 1,
    state: execution.state,
  };
}
async function check(id: string, kind: string, work: () => Promise<unknown> | unknown) {
  if (only && !only.includes(id)) return;
  const began = Date.now(),
    firstCall = calls.length;
  const record: Record<string, unknown> = { id, kind, passed: false };
  results.push(record);
  try {
    record.actual = await work();
    record.passed = true;
  } catch (error) {
    record.failure =
      error instanceof assert.AssertionError
        ? { code: error.code, actual: error.actual, expected: error.expected }
        : { name: error instanceof Error ? error.name : 'unknown' };
  } finally {
    record.durationMs = Date.now() - began;
    record.calls = calls.slice(firstCall);
    await save();
    console.log(JSON.stringify({ id, passed: record.passed, durationMs: record.durationMs }));
  }
}
async function save() {
  await writeFile(
    file,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        mode: real ? 'real-model-frozen-business-adapter' : 'mock-model-frozen-business-adapter',
        baselineSha256: createHash('sha256')
          .update(await readFile('docs/plans/ai-assistant/development-baseline.json'))
          .digest('hex'),
        clock: now.toISOString(),
        ruleVersion: 'v1',
        promptVersions: [ORCHESTRATION_VERSION, RELEVANCE_PROMPT_VERSION],
        syntheticFields: [
          'missing createdAt',
          'batch identity/name',
          'distributor name/address snippet reconstructed from boolean',
        ],
        databaseAccess: false,
        selectedCases: only ?? null,
        completeMatrix: !only,
        priceBasis: null,
        results,
        calls,
        passed: results.every((r) => r.passed),
        notes: [
          'No live database, authentication or browser in this report.',
          'Independent cases continue after failures; no automatic retries of failed model calls.',
          'Mock usage is unknown, not zero actual tokens.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
async function main() {
  let mainExecution: Execution | undefined;
  for (let n = 1; n <= (real ? 3 : 1); n++)
    await check(`REAL-01#${n}`, real ? 'real-model' : 'mock', async () => {
      const execution = await loop(
        '帮我找下这个月我去荔湾广场买了哪些绿松石相关的配件。',
        mainPatch,
      );
      // Retain failures and their full safe execution trace before asserting.
      results.at(-1)!.execution = execution;
      mainExecution = execution;
      const actual = verify(execution, baseline.goldenCase.includedEntryIds, '1897.60');
      assert.deepEqual(
        Object.fromEntries(actual.summary.totals.quantities.map((q) => [q.unit, q.knownQuantity])),
        baseline.goldenCase.quantitiesByUnit,
      );
      return actual;
    });
  const previous = { query: semanticQuery, view: 'details' as const };
  const expectedSubset = (test: (r: (typeof baseline.scopedCandidates)[number]) => boolean) =>
    baseline.scopedCandidates
      .filter((r) => baseline.goldenCase.includedEntryIds.includes(r.id) && test(r))
      .map((r) => r.id);
  await check('REAL-02', real ? 'real-model' : 'mock', async () => {
    const x = await loop('帮我找下这个月我去荔湾广场买了哪些绿松石相关的配饰。', {
      ...mainPatch,
      semantic: {
        material: [semanticQuery.semantic[0]],
        purpose: [{ concept: 'purpose', text: '配饰', relation: 'is' }],
      },
    });
    results.at(-1)!.execution = x;
    return verify(x, baseline.goldenCase.includedEntryIds, '1897.60');
  });
  for (const [id, form, amount] of [
    ['REAL-03', '圆珠', '869.40'],
    ['REAL-04', '提溜', '170.70'],
    ['REAL-05', '直切', '185.00'],
  ])
    await check(id, real ? 'real-model' : 'mock', async () => {
      const x = await loop(
        id === 'REAL-05' ? '这个月荔湾广场买的绿松石直切' : `只看${form}`,
        {
          hard: {},
          semantic: { form: [{ concept: 'form', text: form, relation: 'is' }] },
          clarification: null,
        },
        previous,
      );
      results.at(-1)!.execution = x;
      return verify(
        x,
        expectedSubset(
          (r) =>
            r.name.includes(form) ||
            r.aliases.some((a) => a.includes(form)) ||
            r.tags.includes(form),
        ),
        amount,
      );
    });
  await check('REAL-06', 'text-loop-location', async () => {
    const resolution = resolveLocationRows(
      { text: '荔湾广场', kind: 'exact_place' },
      fixture.distributors,
    );
    assert.deepEqual(
      resolution.confirmed.map((r) => r.distributor.id).sort(),
      [...baseline.scope.distributorIds].sort(),
    );
    assert.equal(resolution.uncertain.length, 2);
    const x = await loop('查找荔湾广场的渠道商，按确定和待确认分别列出。', {
      subject: 'catalog',
      hard: { location: { text: '荔湾广场', kind: 'exact_place' } },
      semantic: {},
      view: 'distributors',
      clarification: null,
    });
    results.at(-1)!.execution = x;
    assert.equal(x.state?.view, 'distributors');
    assert.equal(x.status, 'needs_confirmation');
    const view = assistantResultView(x.result, false)!;
    assert.equal(view.kind, 'distributors');
    assert.deepEqual(
      view.distributors?.confirmed.map((r) => r.distributor.id).sort(),
      [...baseline.scope.distributorIds].sort(),
    );
    assert.equal(view.distributors?.uncertain.length, 2);
    const hidden = JSON.stringify(assistantResultView(x.result, true));
    assert(!hidden.includes('合成渠道商名称') && !hidden.includes('荔湾广场'));
    return { resolution, view };
  });
  const source = await readAssistantPurchases(fixture.tx, {
    query: semanticQuery,
    selectedPurchases: baseline.goldenCase.includedEntryIds.map((id) => ({
      type: 'MATERIAL_PURCHASE',
      id,
    })),
  });
  await check('REAL-07', 'deterministic-pagination', async () => {
    const runs = new PurchaseRuns();
    let page = await runs.query('a', { query: semanticQuery }, async () => source);
    const ids: string[] = [],
      pages: number[] = [];
    for (;;) {
      pages.push(page.items.length);
      ids.push(...page.items.map((r) => r.purchase.id));
      assert.equal(page.summary.totals.amounts[0].knownAmount, '1897.60');
      if (!page.nextCursor) break;
      page = await runs.query(
        'a',
        { query: { ...semanticQuery, pagination: { limit: 5, cursor: page.nextCursor } } },
        async () => source,
      );
    }
    assert.deepEqual(pages, [5, 5, 1]);
    assert.equal(new Set(ids).size, 11);
    return { pages, ids };
  });
  await check('REAL-08', 'deterministic-identities', () => {
    const rows = source.rows.filter((r) => /羽毛/.test(r.name));
    assert.equal(new Set(rows.map((r) => r.item.id)).size, 2);
    assert.equal(new Set(rows.map((r) => r.purchase.id)).size, 2);
    return rows;
  });
  await check('REAL-09', real ? 'real-model-followup' : 'mock', async () => {
    const x = await loop(
      '按供应商汇总',
      { hard: {}, semantic: {}, view: 'by_distributor', clarification: null },
      previous,
    );
    results.at(-1)!.execution = x;
    const actual = verify(x, baseline.goldenCase.includedEntryIds, '1897.60');
    assert.equal(x.state?.view, 'by_distributor');
    for (const group of actual.summary.byDistributor)
      assert.equal(
        group.totals.amounts[0].knownAmount,
        baseline.goldenCase.distributorGroups[
          group.distributor.id as keyof typeof baseline.goldenCase.distributorGroups
        ].amount,
      );
    return actual;
  });
  await check('REAL-10', 'reader-hard-scope-negative-controls', async () => {
    const entry = { ...fixture.entries[0], batch: { ...fixture.entries[0].batch } };
    entry.id = fixtureId(9000);
    entry.materialId = fixture.entries.find((r) => r.material.name.includes('绿松石'))!.materialId;
    entry.material = fixture.materials.find((r) => r.id === entry.materialId)!;
    entry.distributorId = fixtureId(9001);
    entry.distributor = { ...fixture.distributors[0], id: entry.distributorId };
    fixture.entries.push(entry);
    const old = {
      ...entry,
      id: fixtureId(9002),
      distributorId: fixture.entries[0].distributorId,
      batch: { ...entry.batch, receivedAt: new Date('2026-10-31T00:00:00Z') },
    };
    fixture.entries.push(old);
    try {
      const recalled = await readAssistantRecall(fixture.tx, semanticQuery);
      assert.equal(recalled.rows.length, 44);
      assert(!recalled.rows.some((r) => [entry.id, old.id].includes(r.candidate.purchase!.id)));
      const excluded = recalled.rows.filter(
        (r) =>
          assessSemanticCandidate(r.candidate, semanticQuery.semantic).decision?.status ===
          'exclude',
      );
      assert.equal(excluded.length, 33);
      return { candidates: 44, excluded: 33, offScopeControlsExcluded: true };
    } finally {
      fixture.entries.splice(-2);
    }
  });
  // Boundary batch repeated three times in real mode, including prompt-like business text.
  for (let repetition = 1; repetition <= (real ? 3 : 1); repetition++) {
    let evaluated: Awaited<ReturnType<RelevanceRuns['start']>> | undefined;
    await check(`SEM-batch#${repetition}`, real ? 'real-model' : 'mock', async () => {
      const runs = new RelevanceRuns();
      const run = await runs.start('a', boundaryQuery, async (q) =>
        annotateEvaluationRecall(
          boundaryCases.map((c) => c.detail),
          q,
        ),
      );
      evaluated = await runs.advance(
        'a',
        {
          runId: run.runId,
          revision: run.revision,
          budget: {
            batchSize: 50,
            maxReservedTokens: 500000,
            maxInputBytes: 300000,
            maxOutputTokens: 8000,
            callTimeoutMs: 60000,
            stepTimeoutMs: 120000,
          },
        },
        judge,
      );
      assert.equal(evaluated.completeness.evaluation, 'complete');
      return evaluated;
    });
    for (let i = 0; i < 12; i++) {
      const id = i < 8 ? i + 1 : i + 2;
      await check(
        `SEM-${String(id).padStart(2, '0')}#${repetition}`,
        'evidence-bound-batch-result',
        () => {
          const c = boundaryCases[i];
          const decision = evaluated?.decisions.find(
            (d) => candidateKey(d) === candidateKey(c.detail.candidate),
          );
          assert.equal(decision?.status, c.expected);
          assert(decision!.evidence.length);
          return decision;
        },
      );
    }
  }
  await check('SEM-09', real ? 'real-model' : 'mock', async () => {
    const q = {
      ...boundaryQuery,
      semantic: [
        { concept: 'material' as const, text: '绿松石', relation: 'used_with' as const },
        boundaryQuery.semantic[1],
      ],
    };
    const runs = new RelevanceRuns();
    const run = await runs.start('a', q, async () =>
      annotateEvaluationRecall([boundaryCases[7].detail], q),
    );
    const evaluated = await runs.advance('a', { runId: run.runId, revision: 0 }, judge);
    assert.equal(evaluated.decisions[0]?.status, 'include');
    return evaluated;
  });
  await check('SEM-14', 'invalid-reference-rejection', () => {
    const c = boundaryCases[0].detail.candidate;
    assert.throws(() =>
      decisionsForCandidatesSchema([c]).parse([
        {
          ...assessSemanticCandidate(c, boundaryQuery.semantic).decision,
          item: { ...c.item, id: fixtureId(8888) },
        },
      ]),
    );
    return { rejected: true };
  });
  await check('TIME-01', 'reader-date-boundaries', async () => {
    const base = fixture.entries[0];
    const additions = ['2026-10-31', '2026-11-01', '2026-11-30', '2026-12-01'].map((date, i) => ({
      ...base,
      id: fixtureId(9100 + i),
      batch: { ...base.batch, receivedAt: new Date(`${date}T00:00:00Z`) },
    }));
    fixture.entries.push(...additions);
    try {
      const x = await readAssistantRecall(fixture.tx, semanticQuery);
      assert.deepEqual(
        x.rows
          .filter((r) => additions.some((a) => a.id === r.candidate.purchase!.id))
          .map((r) => r.candidate.purchase!.id),
        [additions[1].id, additions[2].id],
      );
      return { included: ['2026-11-01', '2026-11-30'] };
    } finally {
      fixture.entries.splice(-4);
    }
  });
  await check('TIME-02', 'server-clock', () => {
    const x = applyAssistantPlan(
      previous,
      { hard: {}, semantic: {}, month: 'previous_month', clarification: null },
      new Date('2027-01-05T04:00:00Z'),
    );
    assert.deepEqual(x.query.hard.purchaseDate, { from: '2026-12-01', to: '2027-01-01' });
    return x.query.hard;
  });
  await check('TIME-03', 'reader-distinct-date-fields', async () => {
    const x = await readAssistantRecall(fixture.tx, semanticQuery);
    const y = await readAssistantRecall(
      fixture.tx,
      assistantQuerySchema.parse({
        ...semanticQuery,
        hard: {
          createdAt: {
            entity: 'catalog',
            from: '2026-11-01T00:00:00+08:00',
            to: '2026-12-01T00:00:00+08:00',
          },
        },
      }),
    );
    assert.equal(x.rows.length, 44);
    assert.equal(y.rows.length, 0);
    return { purchased: 44, created: 0, createdAtSynthetic: true };
  });
  const sum = (rows: typeof source.rows) =>
    summarizeAssistantPurchases(rows, rows.length, 'selected_purchases');
  await check('FACT-01', 'backend-decimal', () => {
    const x = sum([
      source.rows[0],
      { ...source.rows[0], purchase: { ...source.rows[0].purchase, id: fixtureId(9200) } },
    ]);
    assert.equal(x.totals.catalogItemCount, 1);
    assert.equal(x.totals.purchaseEntryCount, 2);
    return x;
  });
  await check('FACT-02', 'reader-recorded-total', async () => {
    const row = fixture.entries[0],
      before = { ...row };
    try {
      row.receivedQty = new Prisma.Decimal(10);
      row.purchaseUnitPrice = new Prisma.Decimal(10);
      row.purchaseTotalAmount = new Prisma.Decimal(90);
      const x = await readAssistantPurchases(fixture.tx, {
        query: semanticQuery,
        selectedPurchases: [{ type: 'MATERIAL_PURCHASE', id: row.id }],
      });
      assert.equal(x.rows[0].amount, '90.00');
      return x.rows[0];
    } finally {
      Object.assign(row, before);
    }
  });
  await check('FACT-03', 'backend-unknown-money', () => {
    const x = sum([
      { ...source.rows[0], amount: null, amountBasis: 'unknown' },
      { ...source.rows[1], amount: '20.00' },
    ]);
    assert.equal(x.totals.amounts[0].knownAmount, '20.00');
    assert.equal(x.totals.amounts[0].unknownAmountEntryCount, 1);
    return x;
  });
  await check('FACT-04', 'backend-unit-separation', () => {
    const x = sum(
      source.rows.slice(0, 3).map((r, i) => ({
        ...r,
        quantity: `${i + 1}.00`,
        unit: (['STRAND', 'BEAD', 'GRAM'] as const)[i],
      })),
    );
    assert.equal(x.totals.quantities.length, 3);
    return x;
  });
  await check('FACT-05', 'reader-current-vs-source-stock', async () => {
    const f = frozenBusinessFixture();
    const row = f.entries[0];
    row.receivedQty = new Prisma.Decimal(10);
    row.remainingQty = new Prisma.Decimal(2);
    f.entries.push(
      {
        ...row,
        id: fixtureId(9300),
        batch: { ...row.batch, receivedAt: new Date('2026-09-01T00:00:00Z') },
        remainingQty: new Prisma.Decimal(4),
      },
      {
        ...row,
        id: fixtureId(9301),
        batch: { ...row.batch, receivedAt: new Date('2026-09-01T00:00:00Z') },
        remainingQty: null as unknown as Prisma.Decimal,
      },
    );
    const selectedPurchases = [{ type: 'MATERIAL_PURCHASE' as const, id: row.id }];
    const current = await readAssistantStock(f.tx, {
      query: semanticQuery,
      selectedPurchases,
      mode: 'catalog_current',
    });
    const origin = await readAssistantStock(f.tx, {
      query: semanticQuery,
      selectedPurchases,
      mode: 'purchase_remaining',
    });
    assert.equal(current.catalogStock[0].knownStock, '6.00');
    assert.equal(current.catalogStock[0].unknownStockBatchCount, 1);
    assert.equal(origin.sourceStock[0].remainingQuantity, '2.00');
    assert.equal(origin.sourceStock[0].purchasedQuantity, '10.00');
    const state: QueryState = {
      query: assistantQuerySchema.parse({
        ...semanticQuery,
        hard: { ...semanticQuery.hard, items: [{ type: 'MATERIAL', id: row.materialId }] },
        semantic: [],
      }),
      view: 'details',
    };
    const facts = adapter({
      recall: (q) => readAssistantRecall(f.tx, q),
      stock: (q) => readAssistantStock(f.tx, q),
      purchases: (q) => readAssistantPurchases(f.tx, q),
    });
    const executions: Execution[] = [];
    results.at(-1)!.stockExecutions = executions;
    for (const [text, mode] of [
      ['这些还剩多少', 'stock'],
      ['这次买的还剩多少', 'purchase_remaining'],
    ] as const) {
      const x = await loop(
        text,
        { hard: {}, semantic: {}, view: mode, clarification: null },
        state,
        facts,
      );
      executions.push(x);
      assert.equal(x.status, 'completed');
      assert.equal(x.state?.view, mode);
      assert.deepEqual(x.state?.query, { ...state.query, pagination: { limit: 100 } });
      const view = assistantResultView(x.result, false)!;
      assert.equal(view.stockMode, mode === 'stock' ? 'catalog_current' : 'purchase_remaining');
      if (mode === 'stock') {
        assert.equal(view.stock?.catalogStock[0].knownStock, '6.00');
        assert.equal(view.stock?.catalogStock[0].unknownStockBatchCount, 1);
      } else {
        assert.equal(view.stock?.sourceStock[0].remainingQuantity, '2.00');
        assert.equal(view.stock?.sourceStock[0].purchasedQuantity, '10.00');
      }
    }
    return { current, origin };
  });
  await check('FACT-06', 'backend-cost-currency-separation', () => {
    const x = sum([
      { ...source.rows[0], amount: '80.00' },
      { ...source.rows[1], amount: '120.00', currency: 'USD', currencyBasis: 'recorded' },
    ]);
    assert.deepEqual(
      x.totals.amounts.map((r) => [r.currency, r.knownAmount]),
      [
        ['CNY', '80.00'],
        ['USD', '120.00'],
      ],
    );
    return x;
  });
  for (const [id, text, patch] of [
    ['FLOW-01', '不限制地点', { hard: { location: null }, semantic: {}, clarification: null }],
    [
      'FLOW-02',
      '改成上个月',
      { hard: {}, semantic: {}, month: 'previous_month', clarification: null },
    ],
  ] as const)
    await check(id, real ? 'real-model-plan' : 'mock-plan', async () => {
      const response = await tool(patch)({
        name: 'plan_query',
        parameters: z.toJSONSchema(planToolSchema),
        messages: [
          { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ text, previous }) },
        ],
        signal: AbortSignal.timeout(30000),
      });
      const x = applyAssistantPlan(previous, JSON.parse(response.arguments), now);
      assert.deepEqual(x.query.semantic, previous.query.semantic);
      if (id === 'FLOW-01') {
        assert.equal(x.query.hard.location, undefined);
        assert.deepEqual(x.query.hard.purchaseDate, previous.query.hard.purchaseDate);
      } else {
        assert.deepEqual(x.query.hard.location, previous.query.hard.location);
        assert.deepEqual(x.query.hard.purchaseDate, { from: '2026-10-01', to: '2026-11-01' });
      }
      return { state: x, usage: response.usage };
    });
  await check('FLOW-03', 'empty-scope', async () => {
    const x = await adapter()(
      {
        query: {
          ...semanticQuery,
          hard: { purchaseDate: { from: '2020-01-01', to: '2020-02-01' } },
        },
        view: 'details',
      },
      null,
      new AbortController().signal,
      async () => {},
    );
    assert.equal(x.status, 'no_results');
    return x;
  });
  await check('FLOW-04', 'injected-database-and-model-failure', async () => {
    const a = await adapter({
      recall: async () => {
        throw new Error('database failure');
      },
    })(previous, null, new AbortController().signal, async () => {});
    const b = await adapter({
      model: async () => {
        throw new Error('rate limit');
      },
    })(previous, null, new AbortController().signal, async () => {});
    assert.equal(a.status, 'query_failed');
    assert.equal(b.status, 'model_failed');
    assert.equal(a.result, null);
    assert.equal((b.result as { facts: unknown }).facts, null);
    return { database: a.status, model: b.status, usage: 'injected; not provider fault' };
  });
  await check('FLOW-05', 'injected-budget', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => {
      const r = structuredClone(boundaryCases[0].detail);
      r.candidate.item.id = fixtureId(10000 + i);
      r.candidate.evidence = r.candidate.evidence.map((e) =>
        e.entity.type === 'MATERIAL' ? { ...e, entity: r.candidate.item } : e,
      );
      return r;
    });
    const mock: RelevanceModel = async (input) => ({
      model: 'mock',
      usage: null,
      output: {
        decisions: input.candidates.map((c) => ({
          key: c.key,
          status: 'include',
          evidenceIndexes: [0],
          reason: '构造预算用例',
        })),
      },
    });
    const runs = new RelevanceRuns();
    const x = await runs.start('a', boundaryQuery, async () =>
      annotateEvaluationRecall(rows, boundaryQuery),
    );
    const y = await runs.advance(
      'a',
      { runId: x.runId, revision: 0, budget: { batchSize: 20, maxCalls: 1 } },
      mock,
    );
    assert.equal(y.completeness.evaluatedCandidates, 20);
    assert.equal(y.completeness.notEvaluated, 80);
    assert.equal(y.completeness.stopReason, 'budget');
    return y.completeness;
  });
  await check('FLOW-06', 'uncertain-excluded-from-confirmed-summary', async () => {
    const f = frozenBusinessFixture();
    const row = f.entries.find((r) => baseline.goldenCase.includedEntryIds.includes(r.id))!;
    row.material.notes = '材质待核对';
    const x = await createAssistantFacts({
      accountId: 'a',
      recall: (q) => readAssistantRecall(f.tx, q),
      purchases: (q) => readAssistantPurchases(f.tx, q),
      stock: (q) => readAssistantStock(f.tx, q),
      model: judge,
      relevanceBudget: {
        batchSize: 50,
        maxCallsPerStep: 20,
        maxReservedTokens: 500000,
        maxOutputTokens: 8000,
        maxInputBytes: 300000,
      },
    })(previous, null, new AbortController().signal, async () => {});
    assert.equal(x.status, 'needs_confirmation');
    const r = x.result as { facts: Facts; relevance: { completeness: { uncertain: number } } };
    assert.equal(r.relevance.completeness.uncertain, 1);
    assert.equal(r.facts.items.length, 10);
    assert(!r.facts.items.some((r) => r.purchase.id === row.id));
    return { status: x.status, summary: r.facts.summary };
  });
  await check('FLOW-07', 'prompt-like-business-data', async () => {
    const c = boundaryCases.at(-1)!;
    const runs = new RelevanceRuns();
    const x = await runs.start('a', boundaryQuery, async () =>
      annotateEvaluationRecall([c.detail], boundaryQuery),
    );
    const y = await runs.advance('a', { runId: x.runId, revision: 0 }, judge);
    assert.equal(y.decisions[0]?.status, 'uncertain');
    return y.decisions;
  });
  await check('FLOW-08', 'account-bound-run-plus-separate-conversation-tests', async () => {
    const runs = new RelevanceRuns();
    const x = await runs.start('a', semanticQuery, (q) => readAssistantRecall(fixture.tx, q));
    assert.throws(() => runs.read('b', { runId: x.runId }));
    return {
      accountRunDenied: true,
      conversationEvidence:
        'ai-assistant-conversation-service.test.ts; P6 development store verification',
    };
  });
  await check('FLOW-09', real ? 'real-model-missing-buyer' : 'mock-missing-buyer', async () => {
    const x = await loop(
      '只查我本人采购，数据库只有 createdBy 录入者记录',
      { hard: {}, semantic: {}, clarification: '缺少实际采购人字段，请确认范围。' },
      previous,
    );
    results.at(-1)!.execution = x;
    assert.equal(x.status, 'needs_confirmation');
    assert.equal(x.result, null);
    return { clarification: x.clarification, calls: x.calls };
  });
  await check('FLOW-10', 'cancel-late-model', async () => {
    const runs = new RelevanceRuns();
    const x = await runs.start('a', boundaryQuery, async () =>
      annotateEvaluationRecall([boundaryCases[0].detail], boundaryQuery),
    );
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const pending = runs.advance('a', { runId: x.runId, revision: 0 }, async (input) => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
      return {
        model: 'late-mock',
        usage: null,
        output: {
          decisions: input.candidates.map((c) => ({
            key: c.key,
            status: 'include',
            evidenceIndexes: [0],
            reason: 'late mock',
          })),
        },
      };
    });
    await started;
    runs.cancel('a', { runId: x.runId, revision: runs.read('a', { runId: x.runId }).revision });
    release();
    await pending;
    const y = runs.read('a', { runId: x.runId });
    assert.equal(y.completeness.stopReason, 'cancelled');
    assert.equal(y.decisions.length, 0);
    return y.completeness;
  });
  await check('PRIVACY-01', 'backend-result-projection', () => {
    assert(mainExecution);
    const full = assistantResultView(mainExecution.result, false);
    assert(full);
    const hidden = assistantResultView(mainExecution.result, true)!;
    assert.equal(hidden.summary!.totals.amounts.length, 0);
    assert(
      hidden.purchases.every((r) => r.amount === null && r.unitPrice === null && r.name === ''),
    );
    return { hiddenAmounts: true, hiddenText: true, fullCount: full.purchases.length };
  });
  await save();
  console.log(
    JSON.stringify({
      file,
      cases: results.length,
      failed: results.filter((r) => !r.passed).map((r) => r.id),
      modelCalls: real ? calls.length : 0,
    }),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch(async () => {
  results.push({ id: 'HARNESS', passed: false, failure: 'SETUP_OR_FIXTURE_FAILED' });
  await save();
  console.error(JSON.stringify({ file, failure: 'SETUP_OR_FIXTURE_FAILED' }));
  process.exitCode = 1;
});
