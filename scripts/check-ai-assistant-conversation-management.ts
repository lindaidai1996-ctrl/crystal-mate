// Isolated development DB only; no business writes or model calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import { newAssistantExecution } from '../src/lib/ai-assistant/orchestrator';

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
  const ownerId = `assistant-management-${randomUUID()}`;
  const checks: string[] = [];
  const report = {
    checkedAt: new Date().toISOString(),
    environment: 'isolated-development',
    realModel: false,
    migrationApplied: false,
    checks,
    passed: false,
  };
  try {
    const [target] = await client.$queryRaw<{ database: string; username: string }[]>`
      SELECT current_database() AS database, current_user AS username
    `;
    assert.equal(target.database, 'crystal_mate_dev');
    assert.equal(target.username, 'crystal_dev');
    if (process.argv.includes('--migrate')) {
      const migration = '20261117040000_assistant_conversation_title';
      const history = await client.$queryRaw<
        { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
      >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
      assert(!history.some((row) => !row.finished_at && !row.rolled_back_at));
      if (
        !history.some(
          (row) => row.migration_name === migration && row.finished_at && !row.rolled_back_at,
        )
      ) {
        const file = `prisma/migrations/${migration}/migration.sql`;
        assert.equal(
          (await readFile(file, 'utf8')).trim(),
          'ALTER TABLE "AssistantConversation" ADD COLUMN "title" VARCHAR(80);',
        );
        // Execute and register this single reviewed migration, never all pending work.
        execFileSync(
          'node_modules/.bin/prisma',
          ['db', 'execute', '--file', file, '--schema', 'prisma/schema.prisma'],
          { stdio: 'pipe' },
        );
        execFileSync('node_modules/.bin/prisma', ['migrate', 'resolve', '--applied', migration], {
          stdio: 'pipe',
        });
        report.migrationApplied = true;
      }
    }
    const store = new AssistantConversationStore(client);
    const session = await store.create(ownerId);
    const second = await store.create(ownerId);
    let listed = await store.list(ownerId);
    assert.equal(listed.items.find((row) => row.id === session.id)?.number, 1);
    assert.equal(listed.items.find((row) => row.id === second.id)?.number, 2);
    assert(listed.items.every((row) => row.title === null));
    checks.push('empty-conversations-have-owner-scoped-numbers-without-hashes');
    await store.rename(ownerId, second.id, '手动名称');
    const manual = await store.begin(
      ownerId,
      second.id,
      0,
      '不要覆盖手动名称',
      newAssistantExecution(null),
    );
    await store.finish(manual, manual.data);
    assert.equal((await store.read(ownerId, second.id)).session.title, '手动名称');
    await store.remove(ownerId, second.id);
    checks.push('first-question-preserves-a-manual-title');
    const execution = newAssistantExecution(null);
    const record = await store.begin(ownerId, session.id, 0, '会话管理验证', execution);
    assert.equal((await store.read(ownerId, session.id)).session.title, '会话管理验证');
    await store.finish(record, execution);
    const followup = await store.begin(
      ownerId,
      session.id,
      1,
      '这是后续问题，不应覆盖标题',
      newAssistantExecution(null),
    );
    assert.equal((await store.read(ownerId, session.id)).session.title, '会话管理验证');
    checks.push('first-question-title-persists-and-followups-do-not-overwrite-it');
    // Existing untitled conversations derive their title from the earliest saved question.
    await client.assistantConversation.update({ where: { id: session.id }, data: { title: null } });
    listed = await store.list(ownerId);
    assert.equal(listed.items[0].title, '会话管理验证');
    assert(!('messages' in listed.items[0]));
    checks.push('legacy-conversations-use-first-question-without-exposing-message-content');
    await store.rename(ownerId, session.id, '本月采购');
    const reloaded = await new AssistantConversationStore(client).read(ownerId, session.id);
    assert.equal(reloaded.session.title, '本月采购');
    assert.equal(reloaded.session.revision, 2);
    assert.equal(reloaded.session.activeExecutionId, followup.id);
    assert.equal((await store.list(ownerId)).items[0].title, '本月采购');
    checks.push('rename-persists-without-interrupting-active-execution');
    await assert.rejects(
      () => store.rename('other-owner', session.id, '不能改名'),
      /CONVERSATION_NOT_FOUND/,
    );
    await assert.rejects(() => store.remove('other-owner', session.id), /CONVERSATION_NOT_FOUND/);
    assert.equal((await store.read(ownerId, session.id)).session.title, '本月采购');
    checks.push('cross-account-rename-and-delete-rejected');
    await store.rename(ownerId, session.id, '联系 user@example.com');
    assert.equal((await store.list(ownerId)).items[0].title, '联系 [email]');
    checks.push('conversation-title-uses-existing-text-minimization');
    await store.feedback(ownerId, {
      requestId: randomUUID(),
      conversationId: session.id,
      executionId: record.id,
      kind: 'misunderstood',
      target: null,
      note: '仅用于级联删除验证',
    });
    await store.remove(ownerId, session.id);
    assert.equal((await store.list(ownerId)).items.length, 0);
    assert.equal(
      await client.assistantExecution.count({ where: { conversationId: session.id } }),
      0,
    );
    assert.equal(await client.assistantMessage.count({ where: { conversationId: session.id } }), 0);
    assert.equal(
      await client.assistantFeedback.count({ where: { conversationId: session.id } }),
      0,
    );
    checks.push('delete-cascades-to-messages-executions-and-feedback');
    await assert.rejects(() => store.save(followup, execution), /STALE_EXECUTION/);
    await assert.rejects(() => store.finish(followup, execution), /STALE_EXECUTION/);
    await assert.rejects(
      () => store.begin(ownerId, session.id, 1, '晚到请求', execution),
      /STALE_REVISION_OR_BUSY/,
    );
    await assert.rejects(() => store.read(ownerId, session.id), /CONVERSATION_NOT_FOUND/);
    checks.push('deleted-conversation-rejects-late-writes-and-reads');
    await client.assistantConversation.createMany({
      data: Array.from({ length: 32 }, (_, index) => ({
        ownerId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
    });
    const firstPage = await store.list(ownerId);
    assert(firstPage.nextCursor);
    const nextPage = await store.list(ownerId, firstPage.nextCursor);
    assert.deepEqual(
      [...firstPage.items, ...nextPage.items].map((row) => row.number),
      Array.from({ length: 32 }, (_, index) => 32 - index),
    );
    assert.equal(nextPage.nextCursor, null);
    checks.push('numbered-default-names-continue-across-list-pages');
    const titleProbe = firstPage.items[0];
    const longQuestion = `查询 联系 user@example.com ${'😀绿松石'.repeat(20)}`;
    await store.begin(ownerId, titleProbe.id, 0, longQuestion, newAssistantExecution(null));
    const generated = (await store.read(ownerId, titleProbe.id)).session.title!;
    assert(generated.startsWith('查询 联系 [email]'));
    assert(!generated.includes('example.com'));
    assert.equal(Array.from(generated).length, 33);
    assert(generated.endsWith('…'));
    assert(!generated.includes('\uFFFD'));
    checks.push('generated-title-is-short-unicode-safe-and-minimizes-sensitive-patterns');
    report.passed = true;
  } finally {
    await client.assistantConversation.deleteMany({ where: { ownerId } });
    await client.$disconnect();
    const file = `docs/plans/ai-assistant/verification/${report.checkedAt.replace(/[:.]/g, '-')}-conversation-naming.json`;
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ file, ...report }));
  }
}
main().catch(() => {
  console.error('CONVERSATION_MANAGEMENT_VERIFICATION_FAILED');
  process.exitCode = 1;
});
