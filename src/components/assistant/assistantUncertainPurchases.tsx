'use client';

import { useState } from 'react';
import { Pagination, Table } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { assistantRecordHref, type AssistantBrowserResults } from '@/lib/ai-assistant/result-view';
import assistantStyles from './assistantPage.module.css';

type Pending = NonNullable<AssistantBrowserResults['uncertainPurchases']>;
export function AssistantUncertainPurchases({
  pending,
  privacy,
}: {
  pending: Pending;
  privacy: boolean;
}) {
  const t = useTranslations('assistant');
  const [page, setPage] = useState(1);
  if (privacy || !pending.items.length) return null;
  const pageSize = 5;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(pending.items.length / pageSize)));
  const rows = pending.items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const name = (row: Pending['items'][number]) => (
    <Link href={assistantRecordHref(row.item, row.purchase)}>{row.name}</Link>
  );
  const amount = (row: Pending['items'][number]) =>
    row.amount === null ? t('unknown') : `${row.amount} ${row.currency ?? t('unknownCurrency')}`;
  return (
    <section aria-label={t('uncertainPurchasesTitle', { count: pending.items.length })}>
      <h3>{t('uncertainPurchasesTitle', { count: pending.items.length })}</h3>
      <p>{t('uncertainPurchasesBasis')}</p>
      <ul>
        {pending.summary.totals.amounts.map((value, index) => (
          <li key={index}>
            {t('uncertainPurchaseAmount')}: {value.knownAmount}{' '}
            {value.currency ?? t('unknownCurrency')} ·{' '}
            {t('unknownAmountRows', { count: value.unknownAmountEntryCount })}
          </li>
        ))}
      </ul>
      <div className={assistantStyles.desktopResults}>
        <Table
          rowKey={(row) => row.purchase.id}
          dataSource={rows}
          columns={[
            { title: t('record'), key: 'name', render: (_, row) => name(row) },
            { title: t('answerFields.reason'), dataIndex: 'reason', key: 'reason' },
            { title: t('purchaseAmount'), key: 'amount', render: (_, row) => amount(row) },
          ]}
          pagination={false}
          size="small"
          tableLayout="fixed"
        />
      </div>
      <div className={assistantStyles.mobileResults}>
        {rows.map((row) => (
          <article key={row.purchase.id} className={assistantStyles.resultCard}>
            {name(row)}
            <p>{row.reason}</p>
            <p>
              {t('purchaseAmount')}: {amount(row)}
            </p>
          </article>
        ))}
      </div>
      {pending.items.length > pageSize && (
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={pending.items.length}
          showSizeChanger={false}
          onChange={setPage}
          responsive
        />
      )}
    </section>
  );
}
