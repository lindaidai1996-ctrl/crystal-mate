// Isolated development business reads + assistant-only writes. Explicit --real for model calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import {
  runAssistantLoop,
  newAssistantExecution,
  safeAssistantCode,
} from '../src/lib/ai-assistant/orchestrator';
import { createAssistantFacts } from '../src/lib/ai-assistant/orchestration-facts';
import {
  createAssistantToolModel,
  type ToolModel,
} from '../src/lib/ai-assistant/orchestration-model';
import {
  judgeAssistantRelevance,
  type RelevanceModel,
} from '../src/lib/ai-assistant/relevance-model';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import { assessSemanticCandidate } from '../src/lib/ai-assistant/semantic-policy';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
dotenv.config({ quiet: true });
async function main() {
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const url = new URL(process.env[key]!);
    assert(
      url.protocol === 'postgresql:' &&
        url.hostname === '127.0.0.1' &&
        url.port === '15432' &&
        url.pathname === '/crystal_mate_dev' &&
        url.username === 'crystal_dev',
      'Isolated development database required',
    );
  }
  const real = process.argv.includes('--real');
  const client = new PrismaClient();
  const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p4-${real ? 'real' : 'mock'}-development-execution.json`;
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    kind: real
      ? 'real-model-development-read-only-business'
      : 'mock-model-development-read-only-business',
    assistantOnlyWrites: true,
    realLoginOrHTTP: false,
  };
  const owner = `assistant-execution-check-${randomUUID()}`;
  let sessionId: string | null = null;
  try {
    const [target] = await client.$queryRaw<
      { database: string; username: string }[]
    >`SELECT current_database() AS database, current_user AS username`;
    assert.equal(target.database, 'crystal_mate_dev');
    assert.equal(target.username, 'crystal_dev');
    async function readOnly<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      return client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
          return work(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
      );
    }
    const mockTool: ToolModel = async ({ name }) => ({
      id: randomUUID(),
      name,
      arguments: JSON.stringify(
        name === 'plan_query'
          ? {
              subject: 'purchases',
              itemTypes: ['MATERIAL'],
              hard: { location: { text: '荔湾广场', kind: 'exact_place' } },
              semantic: {
                material: [{ concept: 'material', text: '绿松石', relation: 'is' }],
                purpose: [{ concept: 'purpose', text: '配件', relation: 'is' }],
              },
              month: 'this_month',
              clarification: null,
            }
          : {},
      ),
      model: 'mock-rules',
      usage: null,
    });
    const mockJudge: RelevanceModel = async (input) => ({
      model: 'mock-rules',
      usage: null,
      output: {
        decisions: input.candidates.map((candidate) => {
          const decision = assessSemanticCandidate(
            { item: candidate.item, purchase: candidate.purchase, evidence: candidate.evidence },
            input.conditions.map((c) => ({
              concept: c.concept,
              text: c.text,
              relation: c.relation,
            })),
          ).decision!;
          return {
            key: candidate.key,
            status: decision.status,
            evidenceIndexes: decision.evidence.map((e) =>
              candidate.evidence.findIndex((v) => JSON.stringify(v) === JSON.stringify(e)),
            ),
            reason: '后端规则 mock；非真实模型',
          };
        }),
      },
    });
    const store = new AssistantConversationStore(client);
    const session = await store.create(owner);
    sessionId = session.id;
    const initial = newAssistantExecution(null);
    const text = '帮我找这个月在荔湾广场买了哪些绿松石相关的配件。';
    const record = await store.begin(owner, session.id, 0, text, initial);
    const execution = await runAssistantLoop({
      execution: initial,
      text,
      model: real ? createAssistantToolModel() : mockTool,
      facts: createAssistantFacts({
        accountId: owner,
        recall: (q) => readOnly((tx) => readAssistantRecall(tx, q)),
        purchases: (q) => readOnly((tx) => readAssistantPurchases(tx, q)),
        stock: (q) => readOnly((tx) => readAssistantStock(tx, q)),
        model: real ? judgeAssistantRelevance : mockJudge,
        relevanceBudget: {
          batchSize: 50,
          maxCallsPerStep: 20,
          maxInputBytes: 250000,
          maxReservedTokens: 500000,
        },
      }),
      save: (data) => store.save(record, data),
      signal: new AbortController().signal,
    });
    await store.finish(record, execution);
    report.status = execution.status;
    report.metadata = execution.metadata;
    report.errorCode = execution.errorCode;
    report.trace = execution.trace;
    report.orchestrationCalls = execution.calls;
    report.reservedTokens = execution.reservedTokens;
    assert.equal(execution.status, 'completed');
    const result = execution.result as {
      facts: {
        items: { purchase: { id: string } }[];
        summary: {
          totals: {
            purchaseEntryCount: number;
            amounts: { knownAmount: string }[];
            quantities: unknown[];
          };
          byDistributor: unknown[];
        };
      };
      relevance: { completeness: unknown; usage: unknown };
    };
    const selectedIds = result.facts.items.map((r) => r.purchase.id).sort();
    report.selectedIds = selectedIds;
    report.summary = result.facts.summary;
    report.completeness = result.relevance.completeness;
    report.relevanceUsage = result.relevance.usage;
    assert.deepEqual(selectedIds, [...baseline.goldenCase.includedEntryIds].sort());
    assert.equal(result.facts.summary.totals.amounts[0].knownAmount, '1897.60');
    const reloaded = await new AssistantConversationStore(client).read(owner, session.id);
    assert.equal(reloaded.latest?.data.status, 'completed');
    assert.equal(reloaded.messages.length, 2);
    report.passed = true;
  } catch (error) {
    report.safeCode = safeAssistantCode(error, 'UNCLASSIFIED');
    report.failureType =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : error instanceof Error
          ? error.name
          : 'UNKNOWN';
    report.passed = false;
    report.failureCode = 'DEVELOPMENT_EXECUTION_CHECK_FAILED';
    process.exitCode = 1;
  } finally {
    if (sessionId)
      await client.assistantConversation.deleteMany({ where: { id: sessionId, ownerId: owner } });
    await client.$disconnect();
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ file, passed: report.passed, status: report.status }));
  }
}
main().catch(() => {
  console.error('DEVELOPMENT_EXECUTION_SETUP_FAILED');
  process.exitCode = 1;
});
