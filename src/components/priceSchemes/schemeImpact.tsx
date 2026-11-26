'use client';
import { Alert, Input, Table } from 'antd';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SchemeImpact as Impact } from '@/lib/price-schemes/contracts';
import css from './priceSchemes.module.css';
const money = (amount: number | null) => (amount === null ? '—' : `¥${(amount / 100).toFixed(2)}`);
export function SchemeImpact({
  impact,
  excluded,
  onChange,
}: {
  impact: Impact;
  excluded: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('priceSchemes');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const rows = impact.rows.filter((row) =>
    `${row.name} ${row.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className={css.stack}>
      <Alert type="info" message={t('impactHelp')} description={t('protectionHelp')} />
      <div className={css.stats}>
        <span>{t('used', { count: impact.total })}</span>
        {(['AUTO', 'MANUAL', 'RETAIN'] as const).map((mode) => (
          <span key={mode}>
            {t(mode)} {impact.rows.filter((row) => row.mode === mode).length}
          </span>
        ))}
        <span>{t('invalidCount', { count: impact.rows.filter((row) => row.error).length })}</span>
        <span>{t('excludedCount', { count: excluded.length })}</span>
      </div>
      <Input.Search
        placeholder={t('searchProduct')}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      <div className={css.table}>
        <Table
          rowKey="id"
          size="small"
          dataSource={rows}
          scroll={{ x: 680 }}
          pagination={{ current: page, pageSize: 20, onChange: setPage, showSizeChanger: false }}
          rowSelection={{
            columnTitle: t('exclude'),
            selectedRowKeys: excluded,
            preserveSelectedRowKeys: true,
            onChange: (keys) => onChange(keys.map(String)),
            getCheckboxProps: (row) => ({
              disabled: row.mode !== 'AUTO' || row.added || row.oldAmountCents === null,
            }),
          }}
          columns={[
            {
              title: t('product'),
              key: 'product',
              render: (_, row) => (
                <div>
                  {row.name}
                  <p className={css.muted}>{row.code}</p>
                </div>
              ),
            },
            { title: t('oldPrice'), dataIndex: 'oldAmountCents', render: money },
            {
              title: t('newPrice'),
              key: 'new',
              render: (_, row) =>
                excluded.includes(row.id)
                  ? money(row.oldAmountCents)
                  : row.error
                    ? t(row.error)
                    : money(row.amountCents),
            },
            {
              title: t('difference'),
              key: 'difference',
              render: (_, row) =>
                row.oldAmountCents === null || row.amountCents === null || row.error
                  ? '—'
                  : money(excluded.includes(row.id) ? 0 : row.amountCents - row.oldAmountCents),
            },
            {
              title: t('state'),
              key: 'state',
              render: (_, row) => (excluded.includes(row.id) ? t('RETAIN') : t(row.mode)),
            },
          ]}
        />
      </div>
    </div>
  );
}
