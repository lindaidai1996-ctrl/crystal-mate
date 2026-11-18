// P7–P10 verification: frozen business readers by default; explicit --real/--dev only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { frozenBusinessFixture } from './lib/assistant-acceptance-fixture';
import { createAssistantFacts } from '../src/lib/ai-assistant/orchestration-facts';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import { readAssistantDisplay } from '../src/lib/ai-assistant/display-data';
import {
  createAssistantToolModel,
  type ToolModel,
} from '../src/lib/ai-assistant/orchestration-model';
import { judgeAssistantRelevance } from '../src/lib/ai-assistant/relevance-model';
import {
  resolveLocationRows,
  searchDictionaryRows,
  type DictionaryRow,
} from '../src/lib/ai-assistant/reference-resolution';
import {
  prepareAgentExecution,
  runComposableAssistant,
} from '../src/lib/ai-assistant/composable-agent';
import { AGENT_VERSION } from '../src/lib/ai-assistant/composable-contracts';
import { safeAssistantCode } from '../src/lib/ai-assistant/orchestrator';
import type { QueryState } from '../src/lib/ai-assistant/orchestration-contracts';
import { factSetFromResult } from '../src/lib/ai-assistant/fact-sets';

dotenv.config({ quiet: true });
const real = process.argv.includes('--real'),
  dev = process.argv.includes('--dev');
const repeats = Number(process.argv.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? '1');
assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 3);
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const report = {
  checkedAt: new Date().toISOString(),
  version: AGENT_VERSION,
  realModel: real,
  database: dev ? 'isolated-development' : 'frozen-fixture',
  businessWrites: false,
  checks: [] as unknown[],
  success: false,
};
const path = `docs/plans/ai-assistant/verification/${report.checkedAt.replace(/[:.]/g, '-')}-agent-${dev ? 'dev' : 'fixed'}-${real ? 'real' : 'mock'}.json`;
let client: PrismaClient | undefined;
const persist = async () => {
  await mkdir('docs/plans/ai-assistant/verification', { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
};
async function main() {
  if (dev) {
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      const u = new URL(process.env[key]!);
      assert(
        u.hostname === '127.0.0.1' &&
          u.port === '15432' &&
          u.pathname === '/crystal_mate_dev' &&
          u.username === 'crystal_dev',
      );
    }
    client = new PrismaClient();
  }
  const fixture = frozenBusinessFixture();
  async function read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!client) return work(fixture.tx);
    return client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [target] = await tx.$queryRaw<
          { database: string; username: string }[]
        >`SELECT current_database() AS database,current_user AS username`;
        assert(target.database === 'crystal_mate_dev' && target.username === 'crystal_dev');
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  }
  const facts = createAssistantFacts({
    accountId: 'agent-read-only-verifier',
    recall: (q) => read((tx) => readAssistantRecall(tx, q)),
    purchases: (q) => read((tx) => readAssistantPurchases(tx, q)),
    stock: (q) => read((tx) => readAssistantStock(tx, q)),
    display: dev
      ? (refs) => read((tx) => readAssistantDisplay(tx, refs))
      : async (refs) =>
          refs.map((ref) => ({
            item: ref.item,
            purchase: ref.purchase,
            name: fixture.materials.find((m) => m.id === ref.item.id)?.name ?? '',
            code: null,
            imageKey: null,
            lengthMm: '1.00',
            widthMm: '1.00',
            heightMm: '1.00',
          })),
    model: real
      ? judgeAssistantRelevance
      : async () => {
          throw Error('Unexpected semantic model in deterministic probe');
        },
    relevanceBudget: {
      batchSize: 50,
      maxCallsPerStep: 2,
      maxInputBytes: 250000,
      maxReservedTokens: 500000,
    },
    location: (q) =>
      read(async (tx) => {
        const rows = await tx.distributor.findMany({
          select: { id: true, name: true, area: true, address: true, notes: true },
          orderBy: { id: 'asc' },
          take: 5001,
        });
        return resolveLocationRows(q, rows.slice(0, 5000), rows.length <= 5000);
      }),
  });
  const scenarios = [
    {
      id: 'inventory',
      text: '本月荔湾广场采购的物料现在总共还剩多少？只给名称、全部当前库存和单位。',
      expectation: 'stock',
    },
    {
      id: 'remaining',
      text: '本月荔湾广场采购的物料，这次采购的各个来源行现在还剩多少？只给名称、来源余量和单位。',
      expectation: 'source_stock',
    },
    {
      id: 'top',
      text: '本月物料按货品统计采购金额，给我金额最高的前三种，只给名称、金额和币种。',
      expectation: 'transform',
    },
    { id: 'anomaly', text: '找出采购价明显异常的物料。', expectation: 'clarify' },
    {
      id: 'names',
      text: '帮我查这个月在荔湾广场进了哪些货？仅告诉我货品名称就行。',
      expectation: 'names',
    },
    {
      id: 'fields',
      text: '查询本月物料采购，只给我名称、采购单价和单位，表格显示。',
      expectation: 'data',
    },
    {
      id: 'group',
      text: '本月采购的物料按渠道商统计采购金额，金额最多的排在前面，只给我渠道商、采购金额和币种。',
      expectation: 'transform',
    },
    {
      id: 'compare',
      text: '比较本月与上个月的物料采购总金额，告诉我两个时期的金额和差额。',
      expectation: 'comparison',
    },
    {
      id: 'price',
      text: '本月各渠道商同一种物料、同规格同单位的最近一次采购单价分别多少？只给名称、规格、渠道商、采购单价、单位。',
      expectation: 'transform',
    },
    {
      id: 'missing',
      text: '本月有哪些物料采购没有填采购单价？只列名称。',
      expectation: 'transform',
    },
    { id: 'threshold', text: '列出快没货的物料。', expectation: 'clarify' },
    { id: 'sales', text: '哪个物料卖得最好？我想知道销量最高的物料。', expectation: 'boundary' },
    {
      id: 'advice',
      text: '结合本月物料采购和当前库存，给我补货参考建议，并说明数据缺口，不要预测销量和用完时间。',
      expectation: 'advice',
    },
    {
      id: 'fuzzy',
      text: '查找名称或描述与小号银色方形配件相关的物料，有多个可能就给我候选，不要擅自选定一个。',
      expectation: 'fuzzy',
    },
    {
      id: 'explain',
      text: '本月荔湾广场的物料采购总金额怎么算出来的？给我汇总并说明来源。',
      expectation: 'explain',
    },
    {
      id: 'exclude',
      text: '本月采购的银配件里，排除耳钩和定位管，只列还有库存的名称。',
      expectation: 'transform',
    },
  ];
  const execute = async (id: string, text: string, state: QueryState | null = null) => {
    let call = 0;
    const deterministic: ToolModel = async ({ messages, name }) => {
      const receipt = messages.findLast((m) => m.role === 'tool');
      const setId = receipt ? JSON.parse(receipt.content!).id : null;
      return {
        id: randomUUID(),
        name,
        model: 'deterministic-probe',
        usage: null,
        arguments: JSON.stringify(
          call++ === 0
            ? {
                action: 'query',
                patch: {
                  subject: 'purchases',
                  itemTypes: ['MATERIAL'],
                  hard: { location: { text: '荔湾广场', kind: 'exact_place' } },
                  semantic: {},
                  month: 'this_month',
                  clarification: null,
                },
                intent: { format: 'names', fields: ['name'], concise: true },
              }
            : {
                action: 'answer',
                blocks: [{ type: 'data', set: setId, format: 'names', fields: ['name'] }],
              },
        ),
      };
    };
    const started = Date.now();
    const actions: unknown[] = [];
    const protocol: unknown[] = [];
    const actualModel = real
      ? createAssistantToolModel(async (input, init) => {
          const response = await fetch(input, init);
          const envelope = (await response.clone().json()) as {
            choices?: {
              finish_reason?: string;
              message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
            }[];
          };
          protocol.push({
            status: response.status,
            choices: envelope.choices?.map((c) => ({
              finish: c.finish_reason,
              calls: c.message?.tool_calls?.map((t) => ({
                name: t.function?.name,
                argumentBytes: t.function?.arguments?.length,
                validJSON: (() => {
                  try {
                    JSON.parse(t.function?.arguments ?? '');
                    return true;
                  } catch {
                    return false;
                  }
                })(),
              })),
            })),
          });
          return response;
        })
      : deterministic;
    const model: ToolModel = async (input) => {
      const response = await actualModel(input);
      actions.push(JSON.parse(response.arguments));
      return response;
    };
    const result = await runComposableAssistant({
      execution: prepareAgentExecution(null, state, false),
      text,
      model,
      facts,
      lookup: (q) =>
        read(async (tx) => {
          const rows: DictionaryRow[] = [];
          if (q.kinds.includes('DISTRIBUTOR'))
            rows.push(
              ...(
                await tx.distributor.findMany({ take: 5001, select: { id: true, name: true } })
              ).map((r) => ({ ...r, type: 'DISTRIBUTOR' as const, aliases: [], parentId: null })),
            );
          if (q.kinds.includes('MATERIAL_CATEGORY'))
            rows.push(
              ...(
                await tx.materialCategory.findMany({
                  take: 5001,
                  select: { id: true, name: true, aliases: true, parentId: true },
                })
              ).map((r) => ({ ...r, type: 'MATERIAL_CATEGORY' as const })),
            );
          return searchDictionaryRows(q, rows, rows.length <= 5000);
        }),
      save: async () => {},
      signal: new AbortController().signal,
      now: () => new Date('2026-11-18T02:00:00Z'),
    });
    const check = {
      id,
      text,
      status: result.status,
      errorCode: result.errorCode,
      durationMs: Date.now() - started,
      calls: result.calls,
      reservedTokens: result.reservedTokens,
      trace: result.trace,
      answer: result.answer,
      actions,
      protocol,
      state: result.state,
      sets: result.agent!.sets.map((s) => ({
        id: s.id,
        count: s.rows.length,
        complete: s.complete,
        parents: s.parents,
      })),
      passed: false,
    };
    report.checks.push(check);
    await persist();
    assert(
      ['completed', 'no_results', 'needs_confirmation'].includes(result.status),
      `${id}: ${result.status}/${result.errorCode}`,
    );
    if (id.startsWith('names') || id.startsWith('followup')) {
      assert(result.answer && !result.answer.fallback, 'Real-model name answer must validate');
      assert(result.answer.blocks.length === 1 && result.answer.blocks[0].type === 'data');
      const block = result.answer.blocks[0];
      assert(block.format === 'names' && block.fields.join() === 'name');
      const primaryQuery = result.state!;
      const independent = await facts(
        primaryQuery,
        null,
        new AbortController().signal,
        async () => {},
      );
      assert(independent.status === 'completed' || independent.status === 'no_results');
      const all = factSetFromResult(independent.result, primaryQuery);
      const expected = new Set(all.rows.map((r) => r.values.item));
      assert(
        block.rows.length === expected.size,
        'Full distinct catalog count must match independent business readers',
      );
      assert(block.rows.every((r) => r.cells[0].href?.startsWith('/admin/')));
    }
    if (id.startsWith('threshold') || id.startsWith('anomaly'))
      assert(result.status === 'needs_confirmation');
    if (id.startsWith('inventory')) assert(result.state?.view === 'stock');
    if (id.startsWith('remaining')) assert(result.state?.view === 'purchase_remaining');
    if (
      id.startsWith('group') ||
      id.startsWith('price') ||
      id.startsWith('missing') ||
      id.startsWith('exclude')
    )
      assert(
        actions.some((a) => (a as { action: string }).action === 'transform'),
        'Data operations must run in backend',
      );
    if (id.startsWith('compare'))
      assert(
        actions.some((a) => JSON.stringify(a).includes('"op":"compare"')),
        'Period comparison must be computed in backend',
      );
    if (id.startsWith('sales'))
      assert(
        !result.agent!.sets.length,
        'Sales capability is absent; do not fabricate a sales query',
      );
    check.passed = true;
    await persist();
    console.log(`${id}: ${result.status}, ${result.calls} calls, ${Date.now() - started}ms`);
    return result;
  };
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const scenario of scenarios.filter((s) => !only || only.split(',').includes(s.id))) {
      if (!real && scenario.id !== 'names') continue;
      const result = await execute(`${scenario.id}-${repeat + 1}`, scenario.text);
      if (scenario.id === 'names' && (!only || only.includes('followup')))
        await execute(
          `followup-${repeat + 1}`,
          '不是本月，改为上个月，其他要求不变。',
          result.state,
        );
    }
  }
  report.success = true;
}
main()
  .catch((error) => {
    report.checks.push({
      fatal: safeAssistantCode(error, 'VERIFICATION_ASSERTION_FAILED'),
      assertion: error instanceof assert.AssertionError ? error.message : undefined,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await persist();
    await client?.$disconnect();
    console.log(path);
  });
