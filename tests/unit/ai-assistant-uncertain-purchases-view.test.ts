import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import zh from '../../messages/zh.json';
import en from '../../messages/en.json';
import { purchaseEntrySchema } from '@/lib/ai-assistant/purchase-contracts';
import { summarizeAssistantPurchases } from '@/lib/ai-assistant/purchase-summary';
import { fixtureId } from '../fixtures/ai-assistant-semantics';

const locale = vi.hoisted(() => ({ value: 'zh' }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    let message: unknown = locale.value === 'zh' ? zh.assistant : en.assistant;
    for (const part of key.split('.')) message = (message as Record<string, unknown>)[part];
    if (typeof message !== 'string') throw Error(`Missing translation: ${key}`);
    return message.replace(/\{(\w+)\}/g, (_, name) => {
      if (!values || !(name in values)) throw Error(`Missing translation value: ${name}`);
      return String(values[name]);
    });
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));
import { AssistantUncertainPurchases } from '@/components/assistant/assistantUncertainPurchases';

const row = purchaseEntrySchema.parse({
  item: { type: 'MATERIAL', id: fixtureId(1) },
  purchase: { type: 'MATERIAL_PURCHASE', id: fixtureId(2) },
  name: '待核对银配件',
  code: null,
  batch: { id: fixtureId(3), name: 'batch', receivedAt: '2026-11-14' },
  distributor: { id: fixtureId(4), name: 'supplier' },
  quantity: '5.00',
  unit: 'BEAD',
  unitPrice: null,
  amount: '7.50',
  amountBasis: 'recorded_total',
  currency: 'CNY',
  currencyBasis: 'business_default',
});
const pending = {
  items: [{ ...row, reason: '名称与本体材质备注冲突' }],
  summary: summarizeAssistantPurchases([row], 2, 'selected_purchases'),
};
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

it.each(['zh', 'en'])(
  'renders names, reasons, links and separate amounts in both layouts: %s',
  (language) => {
    locale.value = language;
    const html = renderToStaticMarkup(
      React.createElement(AssistantUncertainPurchases, { pending, privacy: false }),
    );
    expect(html).toContain(row.name);
    expect(html).toContain(pending.items[0].reason);
    expect(html).toContain('7.50 CNY');
    expect(html).toContain(`/admin/materials/${row.item.id}/batches/${row.purchase.id}`);
    expect(html).toContain(
      language === 'zh' ? '待确认采购（1 条）' : 'Purchases needing confirmation (1)',
    );
    expect(html).toContain('desktopResults');
    expect(html).toContain('mobileResults');
  },
);

it('immediately hides already loaded pending names, amounts and explanations in privacy mode', () => {
  expect(
    renderToStaticMarkup(
      React.createElement(AssistantUncertainPurchases, { pending, privacy: true }),
    ),
  ).toBe('');
});
