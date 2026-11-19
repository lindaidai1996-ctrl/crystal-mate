import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComparisonBatch } from '@/lib/batch-comparison-contracts';
import { buildBatchComparison } from '@/lib/batch-comparison';

const mode = vi.hoisted(() => ({ private: true }));
vi.mock('@/components/privacyMode', () => ({ usePrivacyMode: () => mode.private }));
vi.mock('next-intl', () => ({
  useLocale: () => 'zh',
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    `${key}${values ? JSON.stringify(values) : ''}`,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));
// Render both collapsed columns and expansion content, including values normally off screen.
vi.mock('@/components/paginated-table', () => ({
  PaginatedTable: ({
    dataSource,
    columns,
    expandable,
  }: {
    dataSource: ComparisonBatch[];
    columns: {
      title: React.ReactNode;
      dataIndex?: keyof ComparisonBatch;
      render?: (value: unknown, row: ComparisonBatch) => React.ReactNode;
    }[];
    expandable: { expandedRowRender: (row: ComparisonBatch) => React.ReactNode };
  }) =>
    React.createElement(
      'div',
      null,
      ...dataSource.flatMap((row) => [
        ...columns.map((column, index) =>
          React.createElement(
            'div',
            { key: `${row.id}:${index}` },
            column.title,
            column.render?.(undefined, row),
          ),
        ),
        React.createElement('div', { key: row.id }, expandable.expandedRowRender(row)),
      ]),
    ),
}));
import { ComparisonContent } from '@/components/batchComparison/batchComparisonPage';
import { BatchComparisonButton } from '@/components/batchComparison/batchComparisonButton';

beforeEach(() => {
  vi.stubGlobal('React', React);
  mode.private = true;
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  return buildBatchComparison({ id: 'm', name: 'Crystal', kind: 'material', unit: 'STRAND' }, [
    {
      id: 'e',
      batch: { id: 'b', name: 'November', receivedAt: '2026-11-01' },
      distributor: { id: 'd', name: 'Supplier' },
      quantity: '9',
      amount: '9876.54',
      quantities: { STRAND: '9' },
      prices: { STRAND: '1097.393333' },
      priceSource: 'MANUAL',
      remainingQuantity: '3',
      remainingPercent: '33.33',
      inventoryValue: '3292.18',
      dimensions: null,
      notes: 'Real batch note',
      href: '/admin/materials/m/batches/e',
    },
  ]);
}
describe('comparison privacy and entry visibility', () => {
  it('removes sensitive metrics, plots, labels and expanded values in privacy mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(ComparisonContent, {
        data: fixture(),
        comparisonPath: '/admin/materials/m/batch-comparison',
      }),
    );
    for (const sensitive of [
      '9876.54',
      '1097.393333',
      '3292.18',
      'weightedMean',
      'priceTrend',
      'amountTrend',
      'source_MANUAL',
    ])
      expect(html).not.toContain(sensitive);
    expect(html).toContain('quantityTrend');
    expect(html).toContain('currentRemaining');
    expect(html).toContain('Supplier');
  });
  it('renders prices, cost charts and source annotations with privacy mode off', () => {
    mode.private = false;
    const html = renderToStaticMarkup(
      React.createElement(ComparisonContent, {
        data: fixture(),
        comparisonPath: '/admin/materials/m/batch-comparison',
      }),
    );
    for (const value of [
      '9876.54',
      '1097.393333',
      '3292.18',
      'weightedMean',
      'priceTrend',
      'source_MANUAL',
    ])
      expect(html).toContain(value);
  });
  it('requires two distinct batches, including exhausted batches without counting duplicate rows', () => {
    const render = (entries: { batchId: string }[]) =>
      renderToStaticMarkup(
        React.createElement(BatchComparisonButton, {
          kind: 'product',
          id: 'p',
          entries,
          returnTo: '/admin/products',
        }),
      );
    expect(render([])).toBe('');
    expect(render([{ batchId: 'a' }, { batchId: 'a' }])).toBe('');
    const html = render([{ batchId: 'a' }, { batchId: 'b' }, { batchId: 'a' }]);
    expect(html).toContain('batch-comparison?returnTo=');
    expect(html).toContain('&quot;count&quot;:2');
  });
});
