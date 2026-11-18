// Targeted authenticated HTTP + desktop/mobile check. No password login or production writes.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { chromium, type Browser } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { AssistantConversationStore } from '../src/lib/ai-assistant/conversation-store';
import type { AssistantBrowserConversation } from '../src/lib/ai-assistant/browser-contracts';
import { safeAssistantCode } from '../src/lib/ai-assistant/orchestrator';
import { minimizeAssistantText } from '../src/lib/ai-assistant/privacy';

dotenv.config({ quiet: true });
assert(
  process.argv.includes('--real'),
  'Explicit --real required for billed model/browser verification',
);
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const u = new URL(process.env[key]!);
  assert(
    u.hostname === '127.0.0.1' &&
      u.port === '15432' &&
      u.pathname === '/crystal_mate_dev' &&
      u.username === 'crystal_dev',
  );
}
const client = new PrismaClient();
const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-agent-browser.json`;
const origin = 'http://localhost:3000';
const report = {
  checkedAt: new Date().toISOString(),
  authentication: 'signed short-lived test JWT through real callback; not password login',
  realModel: true,
  businessWrites: false,
  checks: [] as string[],
  steps: [] as unknown[],
  success: false,
};
let browser: Browser | undefined, sessionId: string | undefined, owner: string | undefined;
async function main() {
  const account = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [target] = await tx.$queryRaw<
      { database: string; username: string }[]
    >`SELECT current_database() AS database,current_user AS username`;
    assert(target.database === 'crystal_mate_dev' && target.username === 'crystal_dev');
    return tx.admin.findFirst({ select: { id: true, username: true, sessionVersion: true } });
  });
  assert(account);
  owner = account.id;
  const store = new AssistantConversationStore(client);
  sessionId = (await store.create(owner)).id;
  const token = await encode({
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET!,
    salt: 'authjs.session-token',
    token: { sub: owner, name: account.username, sessionVersion: account.sessionVersion },
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
  page.setDefaultTimeout(30000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  await page.goto(`${origin}/zh/admin/assistant?conversation=${sessionId}`);
  const input = page.getByRole('textbox', { name: '输入你的问题' });
  await input.waitFor();
  const privacy = page.getByRole('switch', { name: '脱敏模式', exact: true });
  if ((await privacy.getAttribute('aria-checked')) === 'true') await privacy.click();
  const api = `${origin}/api/assistant/conversations/${sessionId}`;
  const ask = async (question: string) => {
    await input.fill(question);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url() === api && r.request().method() === 'POST', {
        timeout: 150000,
      }),
      page.getByRole('button', { name: /发送$/ }).click(),
    ]);
    assert(response.status() === 200);
    const snapshot = (await response.json()) as AssistantBrowserConversation;
    report.steps.push({ question, snapshot });
    assert(snapshot.latest?.status === 'completed' || snapshot.latest?.status === 'no_results');
    assert(snapshot.latest.answer && !snapshot.latest.answer.fallback);
    await page.getByRole('log').locator('a').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(
      () =>
        !(document.querySelector('textarea[aria-label="输入你的问题"]') as HTMLTextAreaElement)
          ?.disabled,
    );
    return snapshot;
  };
  const names = await ask('帮我查这个月在荔湾广场进了哪些货？仅告诉我货品名称就行。');
  const block = names.latest!.answer!.blocks[0];
  assert(block.type === 'data' && block.format === 'names' && block.fields.join() === 'name');
  assert(
    block.rows.length > 0 && block.rows.every((row) => row.cells[0].href?.startsWith('/admin/')),
  );
  assert((await page.getByRole('log').locator('table').count()) === 0);
  report.checks.push(
    'Real HTTP names answer contains complete linked names and no result table in the message',
  );
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert(await noOverflow());
  await mkdir('/tmp/crystal-assistant-agent', { recursive: true });
  await page.screenshot({ path: '/tmp/crystal-assistant-agent/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await noOverflow());
  await page.screenshot({ path: '/tmp/crystal-assistant-agent/mobile.png', fullPage: true });
  report.checks.push('1440px desktop and 390px mobile have no page horizontal overflow');
  const followup = await ask('不是本月，改为上个月，其他要求不变。');
  assert(followup.state?.query.hard.purchaseDate?.from.endsWith('-10-01'));
  assert(followup.messages.filter((m) => m.role === 'assistant' && m.answer).length === 2);
  report.checks.push('Month correction preserves names preference and two historical answers');
  await privacy.click();
  const privateSnapshot = await context.request.get(api, {
    headers: { 'x-assistant-privacy': 'on' },
  });
  const projected = (await privateSnapshot.json()) as AssistantBrowserConversation;
  assert(!projected.latest?.answer && projected.messages.every((m) => !m.answer && !m.text));
  assert(projected.latest?.results?.purchases.every((r) => r.amount === null && r.name === ''));
  report.checks.push(
    'Privacy hides historical/generated prose and prices through the real HTTP projection',
  );
  await page.screenshot({ path: '/tmp/crystal-assistant-agent/private.png', fullPage: true });
  assert(pageErrors.length === 0, JSON.stringify(pageErrors));
  report.checks.push('No browser page errors');
  report.success = true;
}
main()
  .catch((error) => {
    report.steps.push({
      error: safeAssistantCode(error, 'BROWSER_VERIFICATION_FAILED'),
      detail:
        error instanceof Error ? minimizeAssistantText(error.message).slice(0, 1500) : undefined,
      assertion: error instanceof assert.AssertionError ? error.message : undefined,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mkdir('docs/plans/ai-assistant/verification', { recursive: true });
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    await browser?.close();
    if (sessionId && owner) await new AssistantConversationStore(client).remove(owner, sessionId);
    await client.$disconnect();
    console.log(file);
  });
