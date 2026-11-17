// P6 live development integration and representative measurements.
// Business tables are read-only. Only precisely identified assistant rows are written/removed.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { semanticQuery } from '../tests/fixtures/ai-assistant-semantics';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import { readAssistantDisplay } from '../src/lib/ai-assistant/display-data';
import { summarizeAssistantPurchases } from '../src/lib/ai-assistant/purchase-summary';
import { assessSemanticCandidate } from '../src/lib/ai-assistant/semantic-policy';
import { candidateKey, assistantQuerySchema } from '../src/lib/ai-assistant/contracts';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import {
  newAssistantExecution,
  runAssistantLoop,
  type Execution,
} from '../src/lib/ai-assistant/orchestrator';
import { createAssistantFacts } from '../src/lib/ai-assistant/orchestration-facts';
import { createAssistantToolModel } from '../src/lib/ai-assistant/orchestration-model';
import { judgeAssistantRelevance } from '../src/lib/ai-assistant/relevance-model';
import { safeAssistantCode } from '../src/lib/ai-assistant/orchestrator';

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
      'Requires isolated development target',
    );
  }
  const real = process.argv.includes('--real');
  const client = new PrismaClient({ log: [] });
  const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p6-development-${real ? 'real' : 'readonly'}.json`;
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    realModel: real,
    database: 'crystal_mate_dev',
    businessWrites: false,
    migration: false,
    productionAccess: false,
    browser: false,
    priceBasis: null,
    runs: [],
    measurements: [],
  };
  const owner = `p6-verification-${randomUUID()}`;
  const ids: string[] = [];
  let businessReads = 0;
  const save = () => writeFile(file, JSON.stringify(report, null, 2) + '\n');
  const readOnly = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
    businessReads++;
    return client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [target] = await tx.$queryRaw<
          { database: string; username: string; readOnly: string }[]
        >`SELECT current_database() AS database, current_user AS username, current_setting('transaction_read_only') AS "readOnly"`;
        assert.deepEqual(target, {
          database: 'crystal_mate_dev',
          username: 'crystal_dev',
          readOnly: 'on',
        });
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  };
  try {
    const snapshot = await readOnly(async (tx) => ({
      recall: await readAssistantRecall(tx, semanticQuery),
      purchases: await readAssistantPurchases(tx, { query: semanticQuery }),
      remaining: await readAssistantStock(tx, { mode: 'purchase_remaining', query: semanticQuery }),
      counts: {
        materials: await tx.material.count(),
        products: await tx.product.count(),
        distributors: await tx.distributor.count(),
        batches: await tx.materialBatch.count(),
        materialPurchaseEntries: await tx.materialBatchEntry.count(),
        productPurchaseEntries: await tx.productPurchaseEntry.count(),
      },
    }));
    const currentIds = snapshot.recall.rows.map((r) => r.candidate.purchase!.id);
    const projection = snapshot.recall.rows.map((r) => ({
      key: candidateKey(r.candidate),
      evidence: r.candidate.evidence.filter(
        (e) =>
          !['createdAt', 'receivedAt'].includes(e.field) &&
          !['BATCH', 'DISTRIBUTOR'].includes(e.entity.type),
      ),
    }));
    report.observed = {
      counts: snapshot.counts,
      frozenCounts: baseline.counts,
      scopedCandidates: currentIds.length,
      missing: baseline.scopedCandidates.filter((r) => !currentIds.includes(r.id)).map((r) => r.id),
      added: currentIds.filter((id) => !baseline.scopedCandidates.some((r) => r.id === id)),
      changedFacts: snapshot.purchases.rows.flatMap((r) => {
        const old = baseline.scopedCandidates.find((b) => b.id === r.purchase.id);
        if (!old) return [];
        return old.amount === r.amount && old.quantity === r.quantity && old.unit === r.unit
          ? []
          : [
              {
                id: r.purchase.id,
                differenceKind:
                  r.amount !== null &&
                  r.quantity !== null &&
                  new Prisma.Decimal(old.amount).eq(r.amount) &&
                  new Prisma.Decimal(old.quantity).eq(r.quantity) &&
                  old.unit === r.unit
                    ? 'decimal_serialization_only'
                    : 'business_value_changed',
                frozen: { amount: old.amount, quantity: old.quantity, unit: old.unit },
                current: { amount: r.amount, quantity: r.quantity, unit: r.unit },
              },
            ];
      }),
      changedRemaining: snapshot.remaining.sourceStock.flatMap((row) => {
        const old = baseline.scopedCandidates.find((r) => r.id === row.purchase.id);
        if (!old) return [];
        return row.remainingQuantity !== null &&
          new Prisma.Decimal(old.remainingQuantity).eq(row.remainingQuantity)
          ? []
          : [
              {
                id: row.purchase.id,
                frozen: old.remainingQuantity,
                current: row.remainingQuantity,
              },
            ];
      }),
      semanticSnapshotSha256: createHash('sha256').update(JSON.stringify(projection)).digest('hex'),
      changedSemanticFields: projection.flatMap((r) => {
        const id = r.key.split(':').at(-1)!;
        const old = baseline.scopedCandidates.find((b) => b.id === id);
        if (!old) return [];
        const value = (field: string) =>
          r.evidence.find((e) => e.entity.id === old.materialId && e.field === field)?.value;
        const tags = r.evidence
          .filter((e) => e.entity.type === 'TAG')
          .map((e) => e.value)
          .sort();
        const category = r.evidence.find(
          (e) => e.entity.type === 'MATERIAL_CATEGORY' && e.field === 'name',
        )?.value;
        return value('name') === old.name &&
          value('notes') === old.notes &&
          JSON.stringify(value('aliases')) === JSON.stringify(old.aliases) &&
          category === old.category &&
          JSON.stringify(tags) === JSON.stringify([...old.tags].sort())
          ? []
          : [{ id, changed: true }];
      }),
      interpretation:
        'Observed development state; differences are reported, never repaired by changing business data or frozen expectations.',
    };
    await save();
    const expected = snapshot.recall.rows
      .filter(
        (r) =>
          assessSemanticCandidate(r.candidate, semanticQuery.semantic).decision?.status ===
          'include',
      )
      .map((r) => r.candidate.purchase!);
    const unknown = snapshot.recall.rows.filter(
      (r) =>
        assessSemanticCandidate(r.candidate, semanticQuery.semantic).decision?.status ===
        'uncertain',
    );
    report.currentRuleUncertainCount = unknown.length;
    const facts = await readOnly(async (tx) => {
      const purchases = await readAssistantPurchases(tx, {
        query: semanticQuery,
        selectedPurchases: expected,
      });
      const stock = await readAssistantStock(tx, {
        mode: 'catalog_current',
        query: semanticQuery,
        selectedPurchases: expected,
      });
      const remaining = await readAssistantStock(tx, {
        mode: 'purchase_remaining',
        query: semanticQuery,
        selectedPurchases: expected,
      });
      const summary = summarizeAssistantPurchases(
        purchases.rows,
        purchases.scopeCandidateCount,
        'selected_purchases',
      );
      if (expected.length) {
        const sql = await tx.$queryRaw<
          {
            unit: string;
            amount: Prisma.Decimal;
            quantity: Prisma.Decimal;
            unknownAmount: bigint;
            unknownQuantity: bigint;
          }[]
        >(
          Prisma.sql`SELECT m.unit::text AS unit, COALESCE(SUM(COALESCE(e."purchaseTotalAmount", e."receivedQty" * e."purchaseUnitPrice")),0) AS amount, COALESCE(SUM(e."receivedQty"),0) AS quantity, COUNT(*) FILTER (WHERE COALESCE(e."purchaseTotalAmount", e."receivedQty" * e."purchaseUnitPrice") IS NULL) AS "unknownAmount", COUNT(*) FILTER (WHERE e."receivedQty" IS NULL) AS "unknownQuantity" FROM "MaterialBatchEntry" e JOIN "Material" m ON m.id=e."materialId" WHERE e.id IN (${Prisma.join(expected.map((r) => r.id))}) GROUP BY m.unit`,
        );
        assert.equal(
          new Prisma.Decimal(summary.totals.amounts[0].knownAmount).eq(
            sql.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0)),
          ),
          true,
        );
        for (const q of summary.totals.quantities) {
          const row = sql.find((r) => r.unit === q.unit)!;
          assert(new Prisma.Decimal(q.knownQuantity).eq(row.quantity));
          assert.equal(q.unknownQuantityEntryCount, Number(row.unknownQuantity));
        }
        assert.equal(
          summary.totals.amounts[0].unknownAmountEntryCount,
          sql.reduce((n, r) => n + Number(r.unknownAmount), 0),
        );
        for (const item of stock.catalogStock) {
          const [row] = await tx.$queryRaw<
            { known: Prisma.Decimal; unknown: bigint }[]
          >`SELECT COALESCE(SUM("remainingQty"),0) AS known, COUNT(*) FILTER (WHERE "remainingQty" IS NULL) AS unknown FROM "MaterialBatchEntry" WHERE "materialId"=${item.item.id}`;
          assert(new Prisma.Decimal(item.knownStock).eq(row.known));
          assert.equal(item.unknownStockBatchCount, Number(row.unknown));
        }
      }
      return {
        summary,
        stock,
        remaining,
        independentlyChecked:
          'parameterized SQL over actual stored totals/quantities/balances; no model arithmetic',
      };
    });
    report.facts = facts;
    // Read-only service timings include network/transaction/guard overhead. Sequential,
    // three observations each; no throughput/p95 claim from this small sample.
    const smallQuery = assistantQuerySchema.parse({
      ...semanticQuery,
      hard: { items: [snapshot.recall.rows[0].candidate.item] },
      semantic: [],
    });
    const catalogQuery = assistantQuerySchema.parse({
      ...semanticQuery,
      subject: 'catalog',
      hard: {},
      semantic: [],
    });
    for (const [label, query] of [
      ['one-item', smallQuery],
      ['main-44-scope', semanticQuery],
      ['all-material-catalog', catalogQuery],
    ] as const) {
      for (let n = 1; n <= 3; n++) {
        const began = Date.now();
        const x = await readOnly((tx) => readAssistantRecall(tx, query));
        (report.measurements as unknown[]).push({
          label,
          repetition: n,
          candidates: x.rows.length,
          durationMs: Date.now() - began,
          modelCalls: 0,
        });
      }
    }
    if (real) {
      const store = new AssistantConversationStore(client);
      const session = await store.create(owner);
      ids.push(session.id);
      await assert.rejects(store.read(`${owner}-other`, session.id));
      await assert.rejects(
        store.begin(`${owner}-other`, session.id, 0, 'foreign', newAssistantExecution(null)),
      );
      report.accountIsolation = 'foreign read and begin rejected in actual development store';
      const model = createAssistantToolModel();
      const makeFacts = () =>
        createAssistantFacts({
          accountId: owner,
          recall: (q) => readOnly((tx) => readAssistantRecall(tx, q)),
          purchases: (q) => readOnly((tx) => readAssistantPurchases(tx, q)),
          stock: (q) => readOnly((tx) => readAssistantStock(tx, q)),
          display: (refs) => readOnly((tx) => readAssistantDisplay(tx, refs)),
          model: judgeAssistantRelevance,
        });
      async function execute(text: string, previous: Execution | null, resume = false) {
        const current = await store.read(owner, session.id);
        const execution = resume
          ? structuredClone(previous!)
          : newAssistantExecution(previous?.state ?? null);
        if (resume) {
          execution.result = null;
          execution.status = 'running';
          if (execution.phase === 'finish') execution.phase = 'query_facts';
        }
        const record = await store.begin(
          owner,
          session.id,
          current.session.revision,
          text,
          execution,
          resume ? current.latest!.id : null,
        );
        const began = Date.now(),
          readsBefore = businessReads;
        const result = await runAssistantLoop({
          execution,
          text,
          model,
          facts: makeFacts(),
          save: (data) => store.save(record, data),
          signal: new AbortController().signal,
        });
        await store.finish(record, result);
        (report.runs as unknown[]).push({
          label: resume ? 'explicit-continue-default-budget' : 'default-natural-main',
          durationMs: Date.now() - began,
          newBusinessTransactions: businessReads - readsBefore,
          execution: result,
        });
        await save();
        return result;
      }
      const text = '帮我找下这个月我去荔湾广场买了哪些绿松石相关的配件。';
      let execution = await execute(text, null);
      // A bounded explicit verification policy, not application automatic paid retries.
      for (let n = 0; n < 4 && ['budget', 'incomplete'].includes(execution.status); n++)
        execution = await execute(text, execution, true);
      assert.equal(execution.status, 'completed');
      const actual = execution.result as {
        facts: { items: { purchase: { id: string } }[]; summary: typeof facts.summary };
        relevance: { completeness: { evaluation: string } };
      };
      assert.deepEqual(
        actual.facts.items.map((r) => r.purchase.id).sort(),
        expected.map((r) => r.id).sort(),
      );
      assert.deepEqual(actual.facts.summary, facts.summary);
      assert.equal(actual.relevance.completeness.evaluation, 'complete');
      report.modelAndLiveFactsMatch = true;
      const reloaded = await new AssistantConversationStore(client).read(owner, session.id);
      assert.equal(reloaded.latest!.data.status, 'completed');
      report.crossStoreReload = true;
      // A small exact-ID query measures orchestration without relevance work.
      const single = await store.create(owner);
      ids.push(single.id);
      const initial = newAssistantExecution(null),
        item = snapshot.recall.rows[0].candidate.item;
      const singleText = `按采购行查物料精确ID ${item.id}。subject=purchases，itemTypes=[MATERIAL]，hard.items只选该ID，不加日期地点或任何semantic条件，view=details。`;
      const record = await store.begin(owner, single.id, 0, singleText, initial);
      const began = Date.now();
      const small = await runAssistantLoop({
        execution: initial,
        text: singleText,
        model,
        facts: makeFacts(),
        save: (data) => store.save(record, data),
        signal: new AbortController().signal,
      });
      await store.finish(record, small);
      (report.runs as unknown[]).push({
        label: 'small-exact-id-no-semantics',
        durationMs: Date.now() - began,
        execution: small,
      });
      assert.equal(small.status, 'completed');
      const independent = await readOnly((tx) => readAssistantPurchases(tx, { query: smallQuery }));
      assert.deepEqual(
        (small.result as { facts: { items: unknown[] } }).facts.items,
        independent.rows,
      );
    }
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure =
      error instanceof assert.AssertionError
        ? { code: error.code, actual: error.actual, expected: error.expected }
        : {
            safeCode: safeAssistantCode(error, 'DEVELOPMENT_CHECK_FAILED'),
            name: error instanceof Error ? error.name : 'unknown',
          };
    process.exitCode = 1;
  } finally {
    for (const id of ids)
      await client.assistantConversation.deleteMany({ where: { id, ownerId: owner } });
    report.cleanedAssistantSessions = ids.length;
    report.businessReadTransactions = businessReads;
    await client.$disconnect();
    await save();
    console.log(JSON.stringify({ file, passed: report.passed }));
  }
}
main().catch(() => {
  console.error('P6_DEVELOPMENT_SETUP_FAILED');
  process.exitCode = 1;
});
