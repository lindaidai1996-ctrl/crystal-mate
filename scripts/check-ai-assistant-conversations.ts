// Development-only persistence and read-only business integration. Never imports production config.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient, Prisma } from '@prisma/client';
import dotenv from 'dotenv';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import { newAssistantExecution } from '../src/lib/ai-assistant/orchestrator';
import { semanticQuery } from '../tests/fixtures/ai-assistant-semantics';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { summarizeAssistantPurchases } from '../src/lib/ai-assistant/purchase-summary';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { randomUUID } from 'node:crypto';
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
  const client = new PrismaClient();
  const checks: { name: string; passed: boolean }[] = [];
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    environment: 'isolated-development',
    realModel: false,
    checks,
  };
  const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p4-conversations.json`;
  try {
    const [target] = await client.$queryRaw<
      { database: string; username: string }[]
    >`SELECT current_database() AS database, current_user AS username`;
    assert.equal(target.database, 'crystal_mate_dev');
    assert.equal(target.username, 'crystal_dev');
    if (process.argv.includes('--migrate')) {
      const migrations = await client.$queryRaw<
        { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
      >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
      assert(
        !migrations.some((m) => !m.finished_at && !m.rolled_back_at),
        'Unresolved existing migration',
      );
      const { readdir } = await import('node:fs/promises');
      const applied = new Set(
        migrations.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name),
      );
      const pending = (await readdir('prisma/migrations', { withFileTypes: true }))
        .filter((f) => f.isDirectory() && !applied.has(f.name))
        .map((f) => f.name);
      assert(
        pending.every((name) => name === '20261117000000_assistant_conversations'),
        'Refusing unrelated pending migrations',
      );
      const sql = await readFile(
        'prisma/migrations/20261117000000_assistant_conversations/migration.sql',
        'utf8',
      );
      assert(
        !/\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+"(?:Material|Product|Distributor|Batch)/i.test(
          sql,
        ),
      );
      execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], { stdio: 'pipe' });
      report.migration = '20261117000000_assistant_conversations';
    }
    const store = new AssistantConversationStore(client);
    const owner = `assistant-verification-${randomUUID()}`; // Synthetic owner; never creates/modifies Admin.
    const session = await store.create(owner);
    try {
      const state = { query: semanticQuery, view: 'details' as const };
      const execution = newAssistantExecution(null);
      const record = await store.begin(owner, session.id, 0, '合成验证查询', execution);
      await store.save(record, execution);
      await store.save(record, { ...execution, state });
      const anotherProcess = new AssistantConversationStore(client);
      assert.deepEqual((await anotherProcess.read(owner, session.id)).latest?.data.state, state);
      checks.push({ name: 'durable-new-store-instance', passed: true });
      await assert.rejects(() => anotherProcess.read('different-account', session.id));
      await assert.rejects(() =>
        anotherProcess.begin('different-account', session.id, 1, 'x', execution),
      );
      checks.push({ name: 'cross-account-read-write-isolation', passed: true });
      const contenders = await Promise.allSettled([
        anotherProcess.begin(owner, session.id, 1, 'a', execution),
        anotherProcess.begin(owner, session.id, 1, 'b', execution),
      ]);
      assert(contenders.every((c) => c.status === 'rejected'));
      checks.push({ name: 'active-lease-prevents-concurrent-claim', passed: true });
      await anotherProcess.cancel(owner, session.id, 1);
      await assert.rejects(() =>
        store.save(record, { ...execution, status: 'completed', result: { stale: true } }),
      );
      const next = await store.begin(owner, session.id, 2, '新请求', execution);
      await assert.rejects(() =>
        store.finish(record, { ...execution, status: 'completed', result: { stale: true } }),
      );
      await store.finish(next, { ...execution, status: 'no_results', result: { synthetic: true } });
      assert.equal(
        (await anotherProcess.read(owner, session.id)).latest?.data.status,
        'no_results',
      );
      checks.push({ name: 'cancel-and-late-response-cas', passed: true });
      const expired = await store.begin(owner, session.id, 3, '模拟进程退出', execution);
      const future = new AssistantConversationStore(client, () => new Date(Date.now() + 200000));
      assert.equal((await future.read(owner, session.id)).interrupted, true);
      const restarted = await future.begin(owner, session.id, 4, '继续', execution, expired.id);
      await assert.rejects(() => store.save(expired, execution));
      await future.finish(restarted, { ...execution, status: 'incomplete' });
      checks.push({ name: 'expired-worker-portable-restart-and-fencing', passed: true });
      const cancelled = await future.cancel(owner, session.id, 5);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.revision, 6);
      assert.equal((await future.read(owner, session.id)).latest?.data.status, 'cancelled');
      assert.equal((await future.cancel(owner, session.id, 6)).revision, 6);
      checks.push({ name: 'cancel-paused-execution-and-idempotent-cancel', passed: true });
      const concurrent = await Promise.allSettled([
        future.begin(owner, session.id, 6, 'a', execution),
        future.begin(owner, session.id, 6, 'b', execution),
      ]);
      assert.equal(concurrent.filter((c) => c.status === 'fulfilled').length, 1);
      const winner = concurrent.find((c) => c.status === 'fulfilled')!;
      assert(winner.status === 'fulfilled');
      await future.finish(winner.value, { ...execution, status: 'completed' });
      assert.equal((await future.cancel(owner, session.id, 7)).status, 'completed');
      checks.push({ name: 'single-concurrent-winner-and-completed-cancel-noop', passed: true });
    } finally {
      // Only the synthetic assistant session and its cascading assistant records.
      await client.assistantConversation.deleteMany({ where: { id: session.id, ownerId: owner } });
    }
    report.business = await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const source = await readAssistantRecall(tx, semanticQuery);
        const expected = baseline.goldenCase.includedEntryIds;
        const rows = source.rows.filter((r) => expected.includes(r.candidate.purchase!.id));
        assert.equal(rows.length, 11);
        const purchases = await readAssistantPurchases(tx, {
          query: semanticQuery,
          selectedPurchases: rows.map((r) => r.candidate.purchase!),
        });
        const summary = summarizeAssistantPurchases(
          purchases.rows,
          purchases.scopeCandidateCount,
          'selected_purchases',
        );
        assert.equal(summary.totals.purchaseEntryCount, 11);
        assert.equal(summary.totals.amounts[0].knownAmount, '1897.60');
        return {
          readOnly: true,
          candidateCount: source.rows.length,
          frozenExpectedCount: rows.length,
          purchaseEntryCount: summary.totals.purchaseEntryCount,
          amounts: summary.totals.amounts,
          quantities: summary.totals.quantities,
          selectionSource: 'frozen-reference-ids-not-live-model',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
    report.passed = true;
  } catch {
    report.passed = false;
    report.errorCode = 'DEVELOPMENT_VERIFICATION_FAILED';
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ file, passed: report.passed, checks }));
  }
}
main().catch(() => {
  console.error('ISOLATION_OR_SETUP_FAILED');
  process.exitCode = 1;
});
