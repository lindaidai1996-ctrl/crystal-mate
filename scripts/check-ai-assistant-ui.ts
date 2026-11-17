// Targeted P5 browser/HTTP checks. Business tables read-only; only temporary assistant rows written.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, type Browser } from '@playwright/test';
import { Prisma, PrismaClient } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import dotenv from 'dotenv';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import { newAssistantExecution } from '../src/lib/ai-assistant/orchestrator';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import { readAssistantDisplay } from '../src/lib/ai-assistant/display-data';
import { summarizeAssistantPurchases } from '../src/lib/ai-assistant/purchase-summary';
import { semanticQuery } from '../tests/fixtures/ai-assistant-semantics';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { assessSemanticCandidate } from '../src/lib/ai-assistant/semantic-policy';
import { completenessSchema } from '../src/lib/ai-assistant/contracts';
import { assistantQuerySchema } from '../src/lib/ai-assistant/contracts';
import type { Execution } from '../src/lib/ai-assistant/orchestrator';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';

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
  const origin = process.env.P5_BASE_URL ?? 'http://localhost:3000';
  assert(/^http:\/\/localhost:300[01]$/.test(origin), 'Local browser verification only');
  const ids: string[] = [];
  const foreignSessions: { id: string; ownerId: string }[] = [];
  const checks: string[] = [];
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    environment: 'isolated-development',
    realModel: false,
    requestedRealModel: process.argv.includes('--real-http'),
    facts:
      'real P2 purchase/stock + read-only display; frozen selection supplied, not model-selected',
    authentication: 'short-lived signed test session through real auth; not password login',
    checks,
  };
  const errors: string[] = [];
  let browser: Browser | undefined;
  let ownerId: string | undefined;
  async function readOnly<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  }
  try {
    const account = await readOnly(async (tx) => {
      const [target] = await tx.$queryRaw<
        { database: string; username: string }[]
      >`SELECT current_database() AS database, current_user AS username`;
      assert.equal(target.database, 'crystal_mate_dev');
      assert.equal(target.username, 'crystal_dev');
      return tx.admin.findFirst({ select: { id: true, username: true, sessionVersion: true } });
    });
    assert(account);
    ownerId = account.id;
    const selectedPurchases = baseline.goldenCase.includedEntryIds.map((id) => ({
      type: 'MATERIAL_PURCHASE' as const,
      id,
    }));
    const purchase = await readOnly((tx) =>
      readAssistantPurchases(tx, { query: semanticQuery, selectedPurchases }),
    );
    const stock = await readOnly((tx) =>
      readAssistantStock(tx, { mode: 'catalog_current', query: semanticQuery, selectedPurchases }),
    );
    const catalog = await readOnly((tx) =>
      readAssistantDisplay(
        tx,
        purchase.rows.map((r) => ({ item: r.item, purchase: r.purchase })),
      ),
    );
    const summary = summarizeAssistantPurchases(
      purchase.rows,
      purchase.scopeCandidateCount,
      'selected_purchases',
    );
    assert.equal(summary.totals.purchaseEntryCount, 11);
    assert.equal(summary.totals.amounts[0].knownAmount, '1897.60');
    checks.push(
      'real read-only 11 purchase rows, exact amount, display metadata and catalog stock',
    );
    const store = new AssistantConversationStore(client);
    const session = await store.create(account.id);
    ids.push(session.id);
    const state = { query: semanticQuery, view: 'details' as const };
    const execution = newAssistantExecution(state);
    execution.status = 'completed';
    const recalled = await readOnly((tx) => readAssistantRecall(tx, semanticQuery));
    const decisions = recalled.rows.map(
      (row) => assessSemanticCandidate(row.candidate, semanticQuery.semantic).decision!,
    );
    const completeness = completenessSchema.parse({
      scope: 'resolved',
      traversal: 'complete',
      evaluation: 'complete',
      countBasis: 'purchase_entry',
      totalCandidates: 44,
      readCandidates: 44,
      uniqueCatalogItems: 44,
      evaluatedCandidates: decisions.length,
      included: decisions.filter((d) => d.status === 'include').length,
      excluded: decisions.filter((d) => d.status === 'exclude').length,
      uncertain: decisions.filter((d) => d.status === 'uncertain').length,
      notEvaluated: 44 - decisions.length,
      unreadCandidates: 0,
      stopReason: null,
    });
    execution.result = {
      relevance: { completeness, decisions },
      facts: {
        items: purchase.rows,
        catalog,
        stock,
        summary,
        queriedAt: new Date().toISOString(),
        view: 'details',
      },
    };
    const record = await store.begin(
      account.id,
      session.id,
      0,
      'P5 UI verification: backend-selected records',
      execution,
    );
    await store.finish(record, execution);
    const token = await encode({
      secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET!,
      salt: 'authjs.session-token',
      token: { sub: account.id, name: account.username, sessionVersion: account.sessionVersion },
      maxAge: 1800,
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addCookies([
      {
        name: 'authjs.session-token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    page.on('pageerror', () => errors.push('PAGE_ERROR'));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type()))
        errors.push(
          message
            .text()
            .replace(/https?:\/\/\S+/g, '[url]')
            .slice(0, 180),
        );
    });
    const url = `${origin}/api/assistant/conversations/${session.id}`;
    const read = await context.request.get(url, { headers: { 'x-assistant-privacy': 'off' } });
    assert.equal(read.status(), 200);
    const value = await read.json();
    assert.equal(value.latest.results.purchases.length, 11);
    assert.equal(value.latest.results.summary.totals.amounts[0].knownAmount, '1897.60');
    assert(!('checkpoint' in value.latest));
    assert(!('ownerId' in value));
    assert.equal(value.latest.progress.totalCandidates, 44);
    assert.equal(value.latest.progress.evaluatedCandidates, 44);
    checks.push('authenticated whitelisted result HTTP DTO');
    const hidden = await (await context.request.get(url)).json();
    assert(!JSON.stringify(hidden).includes('1897.60'));
    assert.equal(hidden.latest.results.summary.totals.amounts.length, 0);
    checks.push('default HTTP privacy removes all amount summaries and free text');
    await page.goto(`${origin}/zh/admin/assistant?conversation=${session.id}`);
    await page.getByRole('region', { name: '结构化结果' }).waitFor();
    await page.getByRole('link', { name: purchase.rows[0].name, exact: true }).first().waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: '/tmp/crystal-p5/p5-02-desktop.png', fullPage: true });
    checks.push('desktop structured results, no horizontal overflow');
    const fullSummary = page.getByRole('region', { name: '确定集合的全量汇总' });
    const before = await fullSummary.innerText();
    await page.locator('.ant-pagination-item-2').last().click();
    assert.equal(await fullSummary.innerText(), before);
    await page.locator('.ant-pagination-item-3').last().click();
    assert.equal(await fullSummary.innerText(), before);
    await page.locator('.ant-pagination-item-1').last().click();
    checks.push('5/5/1 pagination leaves exact all-result summary unchanged');
    const href = await page
      .getByRole('link', { name: purchase.rows[0].name, exact: true })
      .first()
      .getAttribute('href');
    assert(href?.includes(`/batches/${purchase.rows[0].purchase.id}`));
    const detail = await context.request.get(`${origin}${href}`);
    assert.equal(detail.status(), 200);
    checks.push('real purchase detail link opens read-only page');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: '/tmp/crystal-p5/p5-02-mobile.png', fullPage: true });
    checks.push('mobile card results, no horizontal overflow');
    await page.getByRole('switch', { name: '脱敏模式', exact: true }).click();
    await page.getByText('隐私模式已隐藏成本、金额及可能包含成本的名称和自由文本。').waitFor();
    assert.equal(await page.getByText('CNY 220.00', { exact: true }).count(), 0);
    checks.push('privacy toggle removes rendered amounts immediately');
    await page.getByText('纠正本次理解或结果', { exact: true }).click();
    await page
      .getByRole('textbox', { name: '补充说明（理解错了时必填）' })
      .fill('P5 feedback amount 987654.32');
    await page.getByRole('button', { name: '保存反馈', exact: true }).click();
    await page.getByText('已保存为待整理反馈，全局规则未更改。', { exact: true }).waitFor();
    assert(!(await page.locator('body').innerText()).includes('987654.32'));
    for (const label of ['应包含', '不属于']) {
      await page.getByRole('combobox', { name: '反馈类型' }).locator('..').locator('..').click();
      await page.getByText(label, { exact: true }).last().click();
      const selector = page.getByRole('combobox', { name: '关联记录（含已排除与待确认项）' });
      await selector.locator('..').locator('..').click();
      await selector.press('ArrowDown');
      await selector.press('Enter');
      await page.getByRole('button', { name: '保存反馈', exact: true }).click();
      await page.getByText('已保存为待整理反馈，全局规则未更改。', { exact: true }).waitFor();
    }
    const reviewed = await (await context.request.get(url)).json();
    assert.equal(reviewed.feedback.length, 3);
    assert(
      reviewed.feedback.every(
        (row: { status: string; note: unknown; executionId: string; ruleVersion: string }) =>
          row.status === 'pending_review' &&
          row.note === null &&
          row.executionId === record.id &&
          row.ruleVersion === 'v1',
      ),
    );
    assert.equal(reviewed.revision, value.revision);
    const invalidFeedback = await context.request.post(`${origin}/api/assistant/feedback`, {
      data: {
        requestId: crypto.randomUUID(),
        conversationId: session.id,
        executionId: record.id,
        kind: 'misunderstood',
        note: 'x',
        ruleVersion: 'forged',
      },
      headers: { Origin: origin },
    });
    assert.equal(invalidFeedback.status(), 400);
    await page.reload();
    await page.getByText('最近的反馈（最多 50 条） (3)', { exact: true }).waitFor();
    assert(!(await page.locator('body').innerText()).includes('987654.32'));
    checks.push(
      'three feedback types saved through mobile UI, survive refresh, retain question/version, hide notes, no revision/rule mutation',
    );
    const statuses = {
      needs_confirmation: '需要确认',
      query_failed: '业务查询失败',
      model_failed: '模型处理失败',
      incomplete: '尚未查完',
      budget: '执行预算已用完',
      timeout: '执行超时',
      cancelled: '已取消',
      no_results: '范围内没有匹配记录',
    } as const;
    const failureSession = await store.create(account.id);
    ids.push(failureSession.id);
    let revision = 0;
    for (const [status, label] of Object.entries(statuses)) {
      const stopped = newAssistantExecution(state);
      stopped.status = status as keyof typeof statuses;
      const saved = await store.begin(
        account.id,
        failureSession.id,
        revision,
        'synthetic status check',
        stopped,
      );
      await store.finish(saved, stopped);
      revision = saved.generation;
      await page.goto(`${origin}/zh/admin/assistant?conversation=${failureSession.id}`);
      await page
        .getByRole('region', { name: '执行进度' })
        .getByText(label, { exact: true })
        .waitFor();
      assert.equal(await page.getByRole('region', { name: '确定集合的全量汇总' }).count(), 0);
    }
    checks.push('eight terminal states remain distinct; failures have no zero/empty facts');
    const budgetCommand = await context.request.post(
      `${origin}/api/assistant/conversations/${failureSession.id}`,
      {
        data: {
          action: 'message',
          revision,
          text: 'synthetic budget check',
          budget: { maxReservedTokens: 1 },
        },
        headers: { Origin: origin, 'x-assistant-privacy': 'off' },
      },
    );
    assert.equal(budgetCommand.status(), 200);
    const paused = await budgetCommand.json();
    assert.equal(paused.latest.status, 'budget');
    assert.equal(paused.latest.progress.calls, 0);
    const cancelled = await context.request.post(
      `${origin}/api/assistant/conversations/${failureSession.id}`,
      { data: { action: 'cancel', revision: paused.revision }, headers: { Origin: origin } },
    );
    assert.equal(cancelled.status(), 200);
    const cancelledValue = await cancelled.json();
    assert.equal(cancelledValue.latest.status, 'cancelled');
    const resumed = await context.request.post(
      `${origin}/api/assistant/conversations/${failureSession.id}`,
      {
        data: {
          action: 'continue',
          revision: cancelledValue.revision,
          budget: { maxReservedTokens: 1 },
        },
        headers: { Origin: origin },
      },
    );
    assert.equal(resumed.status(), 200);
    const resumedValue = await resumed.json();
    assert.equal(resumedValue.latest.status, 'budget');
    const retried = await context.request.post(
      `${origin}/api/assistant/conversations/${failureSession.id}`,
      {
        data: {
          action: 'retry',
          revision: resumedValue.revision,
          budget: { maxReservedTokens: 1 },
        },
        headers: { Origin: origin },
      },
    );
    assert.equal(retried.status(), 200);
    assert.equal((await retried.json()).latest.status, 'budget');
    const stale = await context.request.post(
      `${origin}/api/assistant/conversations/${failureSession.id}`,
      { data: { action: 'cancel', revision: 0 }, headers: { Origin: origin } },
    );
    assert.equal(stale.status(), 409);
    const crossOrigin = await context.request.post(
      `${origin}/api/assistant/conversations/${failureSession.id}`,
      { data: { action: 'cancel', revision: 0 }, headers: { Origin: 'https://untrusted.invalid' } },
    );
    assert.equal(crossOrigin.status(), 403);
    checks.push(
      'real HTTP message/budget/cancel/continue/retry/CAS/origin checks with zero model calls',
    );
    const foreign = await store.create(`p5-foreign-${failureSession.id}`);
    ids.push(foreign.id);
    foreignSessions.push({ id: foreign.id, ownerId: `p5-foreign-${failureSession.id}` });
    assert.equal(
      (await context.request.get(`${origin}/api/assistant/conversations/${foreign.id}`)).status(),
      404,
    );
    await client.assistantConversation.deleteMany({
      where: { id: foreign.id, ownerId: `p5-foreign-${failureSession.id}` },
    });
    checks.push('real HTTP foreign-conversation read rejected');
    // Delayed responses are HTTP mocks, separate from the real model check below.
    let releaseRead!: () => void;
    let observedRead!: () => void;
    let deliveredRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readObserved = new Promise<void>((resolve) => {
      observedRead = resolve;
    });
    const readDelivered = new Promise<void>((resolve) => {
      deliveredRead = resolve;
    });
    await page.route(`**/api/assistant/conversations/${session.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      observedRead();
      await readGate;
      try {
        await route.fulfill({ json: value });
      } catch {
        /* Switching aborts the old read. */
      }
      deliveredRead();
    });
    await page.goto(`${origin}/zh/admin/assistant?conversation=${session.id}`);
    await readObserved;
    await page.getByRole('button', { name: new RegExp(failureSession.id.slice(0, 6)) }).click();
    await page
      .getByRole('region', { name: '执行进度' })
      .getByText('执行预算已用完', { exact: true })
      .waitFor();
    releaseRead();
    await readDelivered;
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('region', { name: '结构化结果' }).count(), 0);
    assert(page.url().includes(failureSession.id));
    await page.unroute(`**/api/assistant/conversations/${session.id}`);
    checks.push('browser session switch rejects a delayed old read response (HTTP mock)');
    const slowSession = await store.create(account.id);
    ids.push(slowSession.id);
    let releaseCommand!: () => void;
    let observedCommand!: () => void;
    let deliveredCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const commandObserved = new Promise<void>((resolve) => {
      observedCommand = resolve;
    });
    const commandDelivered = new Promise<void>((resolve) => {
      deliveredCommand = resolve;
    });
    await page.route(`**/api/assistant/conversations/${slowSession.id}`, async (route) => {
      if (
        route.request().method() !== 'POST' ||
        route.request().postDataJSON().action !== 'message'
      )
        return route.continue();
      const begun = await store.begin(
        account.id,
        slowSession.id,
        0,
        'synthetic delayed browser command',
        newAssistantExecution(null),
      );
      observedCommand();
      await commandGate;
      try {
        await route.fulfill({
          json: {
            ...value,
            id: slowSession.id,
            revision: 1,
            latest: { ...value.latest, id: begun.id, generation: 1 },
          },
        });
      } catch {
        /* Cancel aborts the old command. */
      }
      deliveredCommand();
    });
    await page.goto(`${origin}/zh/admin/assistant?conversation=${slowSession.id}`);
    await page
      .getByRole('textbox', { name: '输入你的问题' })
      .fill('synthetic delayed browser command');
    await page.locator('form button[type="submit"]').click();
    await commandObserved;
    await page.getByRole('button', { name: /取消执行/ }).click();
    await page
      .getByRole('region', { name: '执行进度' })
      .getByText('已取消', { exact: true })
      .waitFor();
    releaseCommand();
    await commandDelivered;
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('region', { name: '结构化结果' }).count(), 0);
    const cancelledRead = await store.read(account.id, slowSession.id);
    assert.equal(cancelledRead.session.revision, 2);
    assert.equal(cancelledRead.latest!.data.status, 'cancelled');
    await page.unroute(`**/api/assistant/conversations/${slowSession.id}`);
    checks.push(
      'browser cancel retains cancelled generation after a delayed command response (HTTP mock)',
    );
    if (process.argv.includes('--real-http')) {
      const realSession = await store.create(account.id);
      ids.push(realSession.id);
      const item = purchase.rows[0].item;
      report.realModelAttempted = true;
      const real = await context.request.post(
        `${origin}/api/assistant/conversations/${realSession.id}`,
        {
          data: {
            action: 'message',
            revision: 0,
            text: `按采购行查物料精确ID ${item.id}。subject=purchases，itemTypes=[MATERIAL]，hard.items 只选该ID，不加日期地点或任何semantic条件，view=details。`,
          },
          headers: { Origin: origin, 'x-assistant-privacy': 'off' },
          timeout: 150000,
        },
      );
      assert.equal(real.status(), 200);
      const actual = await real.json();
      report.realHttpStatus = actual.latest.status;
      assert.equal(actual.latest.status, 'completed');
      const expected = await readOnly((tx) =>
        readAssistantPurchases(tx, {
          query: assistantQuerySchema.parse({
            version: 'v1',
            subject: 'purchases',
            itemTypes: ['MATERIAL'],
            hard: { items: [item] },
            semantic: [],
            ruleVersion: 'v1',
            pagination: { limit: 100 },
          }),
        }),
      );
      assert.deepEqual(
        actual.latest.results.purchases
          .map((row: { purchase: { id: string } }) => row.purchase.id)
          .sort(),
        expected.rows.map((row) => row.purchase.id).sort(),
      );
      assert(actual.latest.results.catalog.length > 0 && actual.latest.results.stock);
      const persisted = await client.assistantExecution.findUniqueOrThrow({
        where: { id: actual.latest.id },
      });
      const data = persisted.data as unknown as Execution;
      assert(data.trace.every((event) => event.outcome === 'success'));
      checks.push('successful real text execution has no stale stopped stage entries');
      report.realModel = {
        input:
          'one necessary catalog ID plus synthetic query instructions; no names/prices/contacts/account IDs',
        status: data.status,
        calls: data.calls,
        requestedModel: data.metadata.requestedModel,
        responses: data.trace
          .filter((event) => event.usage)
          .map(({ stage, model, usage }) => ({ stage, model, usage })),
      };
      checks.push(
        'real model + authenticated HTTP + live read-only facts/display/stock, exact backend selection',
      );
    }
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure =
      error instanceof Error
        ? error.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 1800)
        : 'UI_CHECK_FAILED';
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (ids.length && ownerId)
      await client.assistantConversation.deleteMany({ where: { ownerId, id: { in: ids } } });
    for (const row of foreignSessions)
      await client.assistantConversation.deleteMany({ where: row });
    await client.$disconnect();
    report.browserErrors = errors;
    if (errors.length) {
      report.passed = false;
      process.exitCode = 1;
    }
    await writeFile(
      `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p5-ui.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
  }
}
void main().catch(() => {
  console.error('P5_UI_SETUP_FAILED');
  process.exitCode = 1;
});
