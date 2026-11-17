// Only this assistant migration may be applied. No unrelated migrations or business writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import { newAssistantExecution } from '../src/lib/ai-assistant/orchestrator';
import { validateAssistantFeedbackTarget } from '../src/lib/ai-assistant/feedback-target';

dotenv.config({ quiet: true });
async function main() {
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const url = new URL(process.env[key]!);
    assert(
      url.hostname === '127.0.0.1' &&
        url.port === '15432' &&
        url.pathname === '/crystal_mate_dev' &&
        url.username === 'crystal_dev',
    );
  }
  const client = new PrismaClient();
  const checks: string[] = [];
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    environment: 'isolated-development',
    realModel: false,
    checks,
  };
  const owner = `assistant-feedback-${randomUUID()}`;
  let conversationId: string | undefined;
  try {
    const [target] = await client.$queryRaw<
      { database: string; username: string }[]
    >`SELECT current_database() AS database, current_user AS username`;
    assert.equal(target.database, 'crystal_mate_dev');
    assert.equal(target.username, 'crystal_dev');
    const name = '20261117020000_assistant_feedback';
    if (process.argv.includes('--migrate')) {
      const history = await client.$queryRaw<
        { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
      >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
      assert(
        !history.some((row) => !row.finished_at && !row.rolled_back_at),
        'Unresolved migration requires review',
      );
      if (
        !history.some(
          (row) => row.migration_name === name && row.finished_at && !row.rolled_back_at,
        )
      ) {
        const file = `prisma/migrations/${name}/migration.sql`;
        const sql = await readFile(file, 'utf8');
        // Pin and review the exact assistant-only SQL before invoking Prisma's selected-file executor.
        assert(sql.includes('CREATE TABLE "AssistantFeedback"'));
        assert(
          !/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(
            sql.replace(/ON DELETE CASCADE ON UPDATE CASCADE/g, ''),
          ),
        );
        execFileSync(
          'node_modules/.bin/prisma',
          ['db', 'execute', '--file', file, '--schema', 'prisma/schema.prisma'],
          { stdio: 'pipe' },
        );
        execFileSync('node_modules/.bin/prisma', ['migrate', 'resolve', '--applied', name], {
          stdio: 'pipe',
        });
        report.migration = {
          name,
          sha256: createHash('sha256').update(sql).digest('hex'),
          method: 'execute selected assistant SQL transaction and register only this migration',
          unrelatedMigrationsExecuted: false,
        };
      }
    }
    const store = new AssistantConversationStore(client);
    const session = await store.create(owner);
    conversationId = session.id;
    const execution = newAssistantExecution(null);
    execution.status = 'needs_confirmation';
    const saved = await store.begin(owner, session.id, 0, 'synthetic feedback question', execution);
    await store.finish(saved, execution);
    const data = {
      requestId: randomUUID(),
      conversationId: session.id,
      executionId: saved.id,
      kind: 'misunderstood' as const,
      target: null,
      note: 'synthetic correction; sk-abcdefghijk must be minimized',
    };
    const before = await store.read(owner, session.id);
    await store.feedback(owner, data);
    await store.feedback(owner, data);
    const after = await new AssistantConversationStore(client).read(owner, session.id);
    assert.equal(after.feedback.length, 1);
    assert.equal(after.feedback[0].status, 'pending_review');
    assert.equal(
      after.feedback[0].questionMessageId,
      before.messages.find((message) => message.role === 'user')!.id,
    );
    assert.equal(after.feedback[0].ruleVersion, execution.metadata.ruleVersion);
    assert(!after.feedback[0].note.includes('sk-abcdefghijk'));
    assert.deepEqual(after.latest!.data, before.latest!.data);
    assert.equal(after.session.revision, before.session.revision);
    checks.push(
      'durable feedback, original question/execution/version, idempotency, minimized note, no execution/rule mutation',
    );
    await assert.rejects(() =>
      store.feedback('another-account', { ...data, requestId: randomUUID() }),
    );
    await assert.rejects(() => store.feedback(owner, { ...data, note: 'changed payload' }));
    checks.push('cross-account feedback rejected; reused id with changed payload rejected');
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const entry = await tx.materialBatchEntry.findFirst({
        select: { id: true, materialId: true },
      });
      assert(entry);
      await validateAssistantFeedbackTarget(tx, {
        item: { type: 'MATERIAL', id: entry.materialId },
        purchase: { type: 'MATERIAL_PURCHASE', id: entry.id },
      });
      await assert.rejects(() =>
        validateAssistantFeedbackTarget(tx, {
          item: { type: 'MATERIAL', id: entry.materialId },
          purchase: { type: 'MATERIAL_PURCHASE', id: `c${'0'.repeat(24)}` },
        }),
      );
    });
    checks.push('real target identity verified read-only; fabricated purchase identity rejected');
    report.passed = true;
  } catch {
    report.passed = false;
    report.failure = 'FEEDBACK_CHECK_FAILED';
    process.exitCode = 1;
  } finally {
    if (conversationId)
      await client.assistantConversation.deleteMany({
        where: { id: conversationId, ownerId: owner },
      });
    await client.$disconnect();
    await writeFile(
      `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p5-feedback.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
  }
}
void main().catch(() => {
  console.error('FEEDBACK_SETUP_FAILED');
  process.exitCode = 1;
});
