// Explicit --dev / --real only. Reads business facts without saving conversations.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { frozenBusinessFixture } from './lib/assistant-acceptance-fixture';
import { createAssistantFacts } from '../src/lib/ai-assistant/orchestration-facts';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import {
  judgeAssistantRelevance,
  type RelevanceModel,
} from '../src/lib/ai-assistant/relevance-model';
import { assistantQuerySchema } from '../src/lib/ai-assistant/contracts';
import { assistantResultView } from '../src/lib/ai-assistant/result-view';
import { SEMANTIC_POLICY_REVISION } from '../src/lib/ai-assistant/semantic-policy';
import { RELEVANCE_PROMPT_VERSION } from '../src/lib/ai-assistant/relevance-contracts';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import {
  prepareAgentExecution,
  runComposableAssistant,
} from '../src/lib/ai-assistant/composable-agent';
import { createAssistantToolModel } from '../src/lib/ai-assistant/orchestration-model';
import { readAssistantDisplay } from '../src/lib/ai-assistant/display-data';

dotenv.config({ quiet: true });
const dev = process.argv.includes('--dev');
const real = process.argv.includes('--real');
const save = process.argv.includes('--save');
const agent = process.argv.includes('--agent');
assert(!agent || real, '--agent requires explicit --real');
const repeats = Number(process.argv.find((arg) => arg.startsWith('--repeat='))?.split('=')[1] ?? 1);
assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 3);
const report = {
  checkedAt: new Date().toISOString(),
  database: dev ? 'isolated-development' : 'frozen-fixture',
  realModel: real,
  businessWrites: false,
  policyRevision: SEMANTIC_POLICY_REVISION,
  promptVersion: RELEVANCE_PROMPT_VERSION,
  success: false,
  checks: [] as unknown[],
};

async function main() {
  if (dev)
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      const target = new URL(process.env[key]!);
      assert(
        target.protocol === 'postgresql:' &&
          target.hostname === '127.0.0.1' &&
          target.port === '15432' &&
          target.pathname === '/crystal_mate_dev' &&
          target.username === 'crystal_dev',
        'Requires isolated development database',
      );
    }
  const client = dev ? new PrismaClient({ log: [] }) : null;
  const fixture = frozenBusinessFixture();
  async function read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    if (!client) return work(fixture.tx);
    return client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [target] = await tx.$queryRaw<{ database: string; username: string }[]>`
          SELECT current_database() AS database, current_user AS username
        `;
        assert.equal(target.database, 'crystal_mate_dev');
        assert.equal(target.username, 'crystal_dev');
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  }
  const query = assistantQuerySchema.parse({
    version: 'v1',
    subject: 'purchases',
    itemTypes: ['MATERIAL', 'PRODUCT'],
    hard: {
      purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
      location: { text: '荔湾广场', kind: 'exact_place' },
    },
    semantic: [{ concept: 'material', text: '银', relation: 'is' }],
    ruleVersion: 'v1',
    pagination: { limit: 100 },
  });
  const mock: RelevanceModel = async (input) => ({
    model: 'deterministic-rule-adapter',
    usage: null,
    output: {
      decisions: input.candidates.map((candidate) => ({
        key: candidate.key,
        status: candidate.ruleAssessment.decision?.status ?? 'uncertain',
        evidenceIndexes: candidate.ruleAssessment.decision?.evidenceIndexes ?? [0],
        reason: '确定性规则复核，不代表真实模型验证',
      })),
    },
  });
  try {
    const facts = createAssistantFacts({
      accountId: 'silver-read-only-verifier',
      recall: (q) => read((tx) => readAssistantRecall(tx, q)),
      purchases: (q) => read((tx) => readAssistantPurchases(tx, q)),
      stock: (q) => read((tx) => readAssistantStock(tx, q)),
      ...(dev
        ? {
            display: (refs: Parameters<typeof readAssistantDisplay>[1]) =>
              read((tx) => readAssistantDisplay(tx, refs)),
          }
        : {}),
      model: real ? judgeAssistantRelevance : mock,
    });
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const outcome = await facts(
        { query, view: 'details' },
        null,
        new AbortController().signal,
        async () => {},
      );
      const view = assistantResultView(outcome.result, false);
      const relevance = (outcome.result as { relevance?: Record<string, unknown> } | null)
        ?.relevance;
      const distributorId = view?.purchases.find((row) => row.name === '6mm18K镀金S925银跑环')
        ?.distributor.id;
      const mingfa = view?.summary?.byDistributor.find(
        (group) => group.distributor.id === distributorId,
      );
      report.checks.push({
        repeat,
        status: outcome.status,
        completeness: relevance?.completeness,
        attempts: (
          relevance?.attempts as
            | { outcome: string; model: string; usage: unknown; errorCode: string | null }[]
            | undefined
        )?.map(({ outcome, model, usage, errorCode }) => ({ outcome, model, usage, errorCode })),
        usage: relevance?.usage,
        count: view?.purchases.length,
        total: view?.summary?.totals.amounts,
        mingfa: mingfa?.totals,
        pendingCount: view?.uncertainPurchases?.items.length ?? 0,
      });
      assert.equal(outcome.status, 'completed');
      assert.equal(view?.purchases.length, 16);
      assert.deepEqual(
        view.purchases.map((row) => row.purchase.id).sort(),
        baseline.scopedCandidates
          .filter((row) => row.name.includes('银'))
          .map((row) => row.id)
          .sort(),
      );
      assert.equal(view.summary!.totals.amounts[0].knownAmount, '946.80');
      assert.equal(mingfa?.totals.purchaseEntryCount, 15);
      assert.equal(mingfa.totals.amounts[0].knownAmount, '911.80');
      assert.equal(view.uncertainPurchases, undefined);
    }
    if (agent) {
      const outcome = await runComposableAssistant({
        execution: prepareAgentExecution(null, null, false),
        text: '帮我查下这个月我在荔湾广场买了哪些银饰',
        model: createAssistantToolModel(),
        facts,
        save: async () => {},
        signal: new AbortController().signal,
        now: () => new Date('2026-11-19T02:00:00Z'),
      });
      const view = assistantResultView(outcome.result, false);
      report.checks.push({
        kind: 'natural-language-agent',
        status: outcome.status,
        calls: outcome.calls,
        errorCode: outcome.errorCode,
        count: view?.purchases.length,
        total: view?.summary?.totals.amounts,
        fallback: outcome.answer?.fallback,
        answerDataRowCounts: outcome.answer?.blocks
          .filter((block) => block.type === 'data')
          .map((block) => block.rows.length),
        trace: outcome.trace.map(({ stage, outcome, usage }) => ({ stage, outcome, usage })),
      });
      assert.equal(outcome.status, 'completed');
      assert.equal(view?.purchases.length, 16);
      assert.equal(view.summary!.totals.amounts[0].knownAmount, '946.80');
      assert.equal(outcome.answer?.fallback, false);
      assert(
        outcome.answer.blocks.some((block) => block.type === 'data' && block.rows.length === 16),
      );
    }
    report.success = true;
  } finally {
    await client?.$disconnect();
    if (save) {
      const directory = 'docs/plans/ai-assistant/verification';
      await mkdir(directory, { recursive: true });
      const path = `${directory}/${report.checkedAt.replace(/[:.]/g, '-')}-silver-${dev ? 'dev' : 'fixed'}-${real ? 'real' : 'mock'}.json`;
      await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
      console.log(path);
    }
    console.log(JSON.stringify(report));
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError ? error.message : 'Silver verification failed',
  );
  process.exitCode = 1;
});
