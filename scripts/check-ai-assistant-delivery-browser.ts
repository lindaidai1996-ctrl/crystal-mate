// Targeted P6 real text flow, not the repository E2E suite. Development only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { chromium, type Browser, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { semanticQuery } from '../tests/fixtures/ai-assistant-semantics';
import type { AssistantBrowserConversation } from '../src/lib/ai-assistant/browser-contracts';
import {
  newAssistantExecution,
  safeAssistantCode,
  type Execution,
} from '../src/lib/ai-assistant/orchestrator';
import { summarizeAssistantPurchases } from '../src/lib/ai-assistant/purchase-summary';
import { resolveLocationRows } from '../src/lib/ai-assistant/reference-resolution';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import { readAssistantDisplay } from '../src/lib/ai-assistant/display-data';
import type { SemanticDecision } from '../src/lib/ai-assistant/contracts';
import type { PurchaseEntry, PurchaseSummary } from '../src/lib/ai-assistant/purchase-contracts';

dotenv.config({ quiet: true });
async function main() {
  if (!process.argv.includes('--real')) {
    console.log(
      'Pass --real to run a billed natural-language browser flow against isolated development.',
    );
    return;
  }
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const u = new URL(process.env[key]!);
    assert(
      u.protocol === 'postgresql:' &&
        u.hostname === '127.0.0.1' &&
        u.port === '15432' &&
        u.pathname === '/crystal_mate_dev' &&
        u.username === 'crystal_dev',
    );
  }
  const origin = 'http://localhost:3000';
  const client = new PrismaClient({ log: [] });
  const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p6-browser-real.json`;
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    environment: 'isolated-development',
    realModel: true,
    authentication:
      'short-lived signed test JWT through actual callback; password login not tested',
    steps: [],
    checks: [],
    errors: [],
    businessWrites: false,
  };
  const checks = report.checks as string[],
    errors = report.errors as string[];
  let pageForFailure: Page | undefined;
  let browser: Browser | undefined, sessionId: string | undefined, ownerId: string | undefined;
  const save = () => writeFile(file, JSON.stringify(report, null, 2) + '\n');
  async function readOnly<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [target] = await tx.$queryRaw<
          { database: string; username: string }[]
        >`SELECT current_database() AS database,current_user AS username`;
        assert.equal(target.database, 'crystal_mate_dev');
        assert.equal(target.username, 'crystal_dev');
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
  }
  try {
    const account = await readOnly((tx) =>
      tx.admin.findFirst({ select: { id: true, username: true, sessionVersion: true } }),
    );
    assert(account);
    ownerId = account.id;
    const store = new AssistantConversationStore(client);
    const session = await store.create(ownerId);
    sessionId = session.id;
    report.verificationSessionId = sessionId;
    await save();
    const resumeSource = process.argv
      .find((arg) => arg.startsWith('--resume-main='))
      ?.slice('--resume-main='.length);
    let resumedMain: Execution | undefined;
    if (resumeSource) {
      assert(
        /^docs\/plans\/ai-assistant\/verification\/[\w.-]+-p6-browser-real\.json$/.test(
          resumeSource,
        ),
      );
      const prior = JSON.parse(await readFile(resumeSource, 'utf8'));
      resumedMain = prior.steps.findLast(
        (step: { status: string }) => step.status === 'completed',
      )?.execution;
      assert(resumedMain?.status === 'completed');
      const record = await store.begin(
        ownerId,
        sessionId,
        0,
        'P6 restore previously verified desktop main; no model call',
        resumedMain,
      );
      await store.finish(record, resumedMain);
      report.mainSource = resumeSource;
      report.seededMain = true;
    }
    const token = await encode({
      secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET!,
      salt: 'authjs.session-token',
      token: { sub: account.id, name: account.username, sessionVersion: account.sessionVersion },
      maxAge: 1800,
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
    pageForFailure = page;
    page.setDefaultTimeout(30000);
    page.on('pageerror', () => errors.push('PAGE_ERROR'));
    page.on('console', (m) => {
      if (['warning', 'error'].includes(m.type()))
        errors.push(
          m
            .text()
            .replace(/https?:\/\/\S+/g, '[url]')
            .slice(0, 150),
        );
    });
    const url = `${origin}/api/assistant/conversations/${sessionId}`;
    await page.goto(`${origin}/zh/admin/assistant?conversation=${sessionId}`);
    await page.getByRole('textbox', { name: '输入你的问题' }).waitFor();
    const privacy = page.getByRole('switch', { name: '脱敏模式', exact: true });
    if ((await privacy.getAttribute('aria-checked')) === 'true') await privacy.click();
    async function command(label: string, action: () => Promise<unknown>) {
      const began = Date.now();
      const [http] = await Promise.all([
        page.waitForResponse((r) => r.url() === url && r.request().method() === 'POST', {
          timeout: 150000,
        }),
        action(),
      ]);
      assert.equal(http.status(), 200);
      const result = (await http.json()) as AssistantBrowserConversation;
      const data = (await store.read(ownerId!, sessionId!)).latest!.data;
      (report.steps as unknown[]).push({
        label,
        durationMs: Date.now() - began,
        status: result.latest!.status,
        progress: result.latest!.progress,
        execution: data,
      });
      await save();
      await page.getByRole('textbox', { name: '输入你的问题' }).waitFor({ state: 'visible' });
      await page.waitForFunction(
        () =>
          !(document.querySelector('textarea[aria-label="输入你的问题"]') as HTMLTextAreaElement)
            ?.disabled,
      );
      return result;
    }
    async function send(label: string, text: string) {
      await page.getByRole('textbox', { name: '输入你的问题' }).fill(text);
      return command(label, () =>
        page
          .locator('form')
          .filter({ has: page.getByRole('textbox', { name: '输入你的问题' }) })
          .evaluate((form: HTMLFormElement) => form.requestSubmit()),
      );
    }
    async function finishPaused(value: AssistantBrowserConversation) {
      let current = value;
      for (let i = 0; i < 4 && ['budget', 'incomplete'].includes(current.latest!.status); i++) {
        const budgetPanel = page
          .locator('details')
          .filter({ has: page.getByText('继续 / 重试的累计预算', { exact: true }) });
        if ((await budgetPanel.getAttribute('open')) === null)
          await page.getByText('继续 / 重试的累计预算', { exact: true }).click();
        const adjust = page.getByRole('checkbox', { name: '使用下列累计上限' });
        await adjust.check();
        await page.getByRole('spinbutton', { name: '理解调用上限（最多 20）' }).fill('12');
        await page.getByRole('spinbutton', { name: '理解预留 tokens 上限' }).fill('500000');
        await page.getByRole('spinbutton', { name: '判断预留 tokens 上限' }).fill('500000');
        current = await command('explicit-browser-continue', () =>
          page.getByRole('button', { name: '继续查询', exact: true }).click(),
        );
      }
      return current;
    }
    if (process.argv.includes('--text-views-only')) {
      const item = await readOnly((tx) =>
        tx.material.findFirst({ orderBy: { id: 'asc' }, select: { id: true } }),
      );
      assert(item);
      let value = await send(
        'desktop-current-stock',
        `按采购行查询物料精确ID ${item.id} 的当前全部库存。subject=purchases，itemTypes=[MATERIAL]，hard.items只选该ID，不加日期地点或semantic条件，view=stock。`,
      );
      assert.equal(value.latest!.status, 'completed');
      assert.equal(value.latest!.results!.stockMode, 'catalog_current');
      const current = await readOnly((tx) =>
        readAssistantStock(tx, { mode: 'catalog_current', query: value.state!.query }),
      );
      assert.deepEqual(value.latest!.results!.stock!.catalogStock, current.catalogStock);
      await page.getByRole('region', { name: '结构化结果' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      value = await send('phone-selected-purchase-remaining', '这次买的还剩多少');
      assert.equal(value.latest!.status, 'completed');
      assert.equal(value.latest!.results!.stockMode, 'purchase_remaining');
      const remaining = await readOnly((tx) =>
        readAssistantStock(tx, { mode: 'purchase_remaining', query: value.state!.query }),
      );
      assert.deepEqual(value.latest!.results!.stock!.sourceStock, remaining.sourceStock);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.reload();
        await page.getByRole('region', { name: '结构化结果' }).waitFor();
        await page.getByText('本次采购来源余量', { exact: true }).first().waitFor();
        assert.equal(
          await page
            .locator(
              width === 390
                ? 'article a[href*="/batches/"]:visible'
                : 'table a[href*="/batches/"]:visible',
            )
            .count(),
          Math.min(5, remaining.sourceStock.length),
        );
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.screenshot({ path: '/tmp/crystal-p6/mobile-source-stock.png', fullPage: true });
      checks.push(
        'current total vs selected source remaining: real model HTTP/live independent P2 read, source identities and batch links, desktop/mobile labels and no overflow',
      );
      value = await send(
        'phone-location-distributors',
        '新查询：查找荔湾广场的渠道商，按确定和待确认分别列出。',
      );
      assert(['completed', 'needs_confirmation'].includes(value.latest!.status));
      assert.equal(value.latest!.results!.kind, 'distributors');
      const locations = await readOnly(async (tx) =>
        resolveLocationRows(
          { text: '荔湾广场', kind: 'exact_place' },
          await tx.distributor.findMany({
            select: { id: true, name: true, area: true, address: true, notes: true },
            orderBy: { id: 'asc' },
            take: 5000,
          }),
        ),
      );
      assert.deepEqual(value.latest!.results!.distributors!.confirmed, locations.confirmed);
      assert.deepEqual(value.latest!.results!.distributors!.uncertain, locations.uncertain);
      assert.equal(value.state!.query.hard.items, undefined);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.reload();
        await page.getByRole('heading', { name: '地点渠道商查询', exact: true }).waitFor();
        assert.equal(
          await page.locator('section[aria-label="结构化结果"] a[href*="/distributors/"]').count(),
          locations.confirmed.length + locations.uncertain.length,
        );
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.screenshot({ path: '/tmp/crystal-p6/desktop-distributors.png', fullPage: true });
      await privacy.click();
      const hidden = (await (
        await context.request.get(url)
      ).json()) as AssistantBrowserConversation;
      assert(
        hidden.latest!.results!.distributors!.confirmed.every(
          (r) => !r.name && !r.area && !r.evidence.length,
        ),
      );
      for (const row of locations.confirmed)
        assert(
          !(await page.getByRole('region', { name: '结构化结果' }).innerText()).includes(row.name),
        );
      checks.push(
        'location confirmed/uncertain match live resolver; new query clears previous item scope; real links, privacy projection and desktop/mobile no overflow',
      );
    } else {
      let value = resumedMain
        ? ((await (
            await context.request.get(url, { headers: { 'x-assistant-privacy': 'off' } })
          ).json()) as AssistantBrowserConversation)
        : await finishPaused(
            await send(
              'desktop-natural-main',
              '帮我找下这个月我去荔湾广场买了哪些绿松石相关的配件。',
            ),
          );
      report.stage = 'verify-main';
      assert.equal(value.latest!.status, 'completed');
      const mainData = (await store.read(ownerId, sessionId)).latest!.data;
      const selectedPurchases = value.latest!.results!.purchases.map((r) => r.purchase);
      const independent = await readOnly((tx) =>
        readAssistantPurchases(tx, { query: value.state!.query, selectedPurchases }),
      );
      assert.deepEqual(value.latest!.results!.purchases, independent.rows);
      assert.equal(value.latest!.results!.purchases.length, 11);
      assert.equal(value.latest!.results!.summary!.totals.amounts[0].knownAmount, '1897.60');
      await page.getByRole('region', { name: '结构化结果' }).waitFor();
      await mkdir('/tmp/crystal-p6', { recursive: true });
      await page.screenshot({ path: '/tmp/crystal-p6/desktop-main.png', fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      checks.push(
        'desktop natural main entered in real UI; real model/default budget/explicit continue; exact live P2 rows and amount; no horizontal overflow',
      );
      report.stage = 'refresh-main';
      await page.reload();
      await page.getByRole('region', { name: '结构化结果' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      report.stage = 'mobile-followup';
      value = await finishPaused(await send('mobile-natural-round-followup', '只看圆珠'));
      assert.equal(value.latest!.status, 'completed');
      assert.equal(value.latest!.results!.purchases.length, 1);
      assert.equal(value.latest!.results!.summary!.totals.amounts[0].knownAmount, '869.40');
      assert.deepEqual(value.state!.query.hard, semanticQuery.hard);
      await page.getByRole('region', { name: '结构化结果' }).waitFor();
      await page.screenshot({ path: '/tmp/crystal-p6/mobile-followup.png', fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      checks.push(
        'refresh restores main; mobile natural follow-up preserves date/place/material/purpose and returns one round bead; no overflow',
      );
      await privacy.click();
      assert(!(await page.locator('body').innerText()).includes('869.40'));
      const hidden = (await (
        await context.request.get(url)
      ).json()) as AssistantBrowserConversation;
      assert.equal(hidden.latest!.results!.summary!.totals.amounts.length, 0);
      assert(hidden.latest!.results!.purchases.every((r) => r.amount === null && !r.name));
      checks.push('mobile immediate privacy hide and default HTTP price/text projection');
      const anonymous = await browser.newContext();
      assert.equal((await anonymous.request.get(url)).status(), 401);
      await anonymous.close();
      await assert.rejects(store.read(`${ownerId}-foreign`, sessionId));
      checks.push('anonymous HTTP and foreign store conversation rejected');
      // Constructed judgment state, real read-only facts. This is not a real model
      // uncertainty claim; it verifies the new FLOW-06 browser projection and label.
      report.stage = 'constructed-uncertainty-display';
      const partial = structuredClone(mainData.result) as {
        relevance: {
          completeness: { included: number; uncertain: number };
          decisions: SemanticDecision[];
          confirmedSelection: {
            item: PurchaseEntry['item'];
            purchase: PurchaseEntry['purchase'];
          }[];
        };
        facts: {
          items: PurchaseEntry[];
          summary: PurchaseSummary;
          queriedAt: string;
          catalog?: unknown;
          stock?: unknown;
        };
      };
      const uncertain = partial.facts.items[0].purchase.id;
      partial.relevance.decisions.find((r) => r.purchase?.id === uncertain)!.status = 'uncertain';
      partial.relevance.completeness.included--;
      partial.relevance.completeness.uncertain++;
      partial.relevance.confirmedSelection = partial.relevance.confirmedSelection.filter(
        (r) => r.purchase.id !== uncertain,
      );
      partial.facts = await readOnly(async (tx) => {
        const selectedPurchases = partial.relevance.confirmedSelection.map((r) => r.purchase);
        const source = await readAssistantPurchases(tx, {
          query: mainData.state!.query,
          selectedPurchases,
        });
        return {
          items: source.rows,
          summary: summarizeAssistantPurchases(
            source.rows,
            source.scopeCandidateCount,
            'selected_purchases',
          ),
          queriedAt: new Date().toISOString(),
          stock: await readAssistantStock(tx, {
            mode: 'catalog_current',
            query: mainData.state!.query,
            selectedPurchases,
          }),
          catalog: await readAssistantDisplay(tx, partial.relevance.confirmedSelection),
        };
      });
      const synthetic = newAssistantExecution(mainData.state);
      synthetic.status = 'needs_confirmation';
      synthetic.result = partial;
      synthetic.clarification = '构造展示验证：待确认项未计入汇总。';
      const current = await store.read(ownerId, sessionId);
      const saved = await store.begin(
        ownerId,
        sessionId,
        current.session.revision,
        'P6 constructed uncertainty display; no model call',
        synthetic,
      );
      await store.finish(saved, synthetic);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.reload();
        await page
          .getByText(
            '部分记录待确认；以下明细、金额、数量和库存只包含已确定记录，待确认项未计入。',
            {
              exact: true,
            },
          )
          .waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      const partialView = (await (
        await context.request.get(url, { headers: { 'x-assistant-privacy': 'off' } })
      ).json()) as AssistantBrowserConversation;
      assert.equal(partialView.latest!.status, 'needs_confirmation');
      assert.equal(partialView.latest!.results!.purchases.length, 10);
      assert.equal(partialView.latest!.results!.selectionIsPartial, true);
      assert(!partialView.latest!.results!.purchases.some((r) => r.purchase.id === uncertain));
      checks.push(
        'constructed FLOW-06 on desktop/mobile: ten confirmed live rows, one uncertain excluded, explicit summary warning; no model call',
      );
    }
    report.persistedExecutions = (
      await client.assistantExecution.findMany({
        where: { conversationId: sessionId, ownerId },
        orderBy: { generation: 'asc' },
        select: { data: true },
      })
    ).map((r) => r.data as unknown as Execution);
    assert.equal(errors.length, 0);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure =
      error instanceof assert.AssertionError
        ? { actual: error.actual, expected: error.expected }
        : {
            name: error instanceof Error ? error.name : 'unknown',
            code: safeAssistantCode(error, 'BROWSER_FLOW_FAILED'),
            detail:
              error instanceof Error && !(error instanceof Prisma.PrismaClientKnownRequestError)
                ? error.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 1500)
                : null,
          };
    await pageForFailure
      ?.screenshot({ path: '/tmp/crystal-p6/failure.png', fullPage: true })
      .catch(() => {});
    process.exitCode = 1;
  } finally {
    await save();
    if (sessionId && ownerId)
      await client.assistantConversation.deleteMany({ where: { id: sessionId, ownerId } });
    report.cleanedAssistantSessions = sessionId ? 1 : 0;
    await client.$disconnect();
    await save();
    await browser?.close();
    console.log(JSON.stringify({ file, passed: report.passed }));
  }
}
main().catch(() => {
  console.error('P6_BROWSER_SETUP_FAILED');
  process.exitCode = 1;
});
