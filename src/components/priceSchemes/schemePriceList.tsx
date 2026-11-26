'use client';
import { Button, Popover } from 'antd';
import { useTranslations } from 'next-intl';
import type { Product } from '@/lib/client-types';
import css from './priceSchemes.module.css';
export function SchemePriceList({ prices = [] }: { prices?: Product['schemePrices'] }) {
  const t = useTranslations('priceSchemes');
  if (!prices.length) return null;
  const shown = prices.filter((row) => row.scheme.common).slice(0, 2);
  const line = (row: (typeof prices)[number], full = false) => (
    <div key={row.schemeId} className={css.stack}>
      <div className={css.priceLine}>
        <span title={row.scheme.name}>{row.scheme.name}</span>
        <strong>{row.amountCents === null ? '—' : `¥${(row.amountCents / 100).toFixed(2)}`}</strong>
      </div>
      {row.mode !== 'AUTO' && <span className={css.badge}>{t(row.mode)}</span>}
      {row.error && <span className={css.muted}>{t(row.error)}</span>}
      {full && row.error && row.previousAmountCents !== null && (
        <span className={css.muted}>
          {t('previous', { amount: (row.previousAmountCents / 100).toFixed(2) })}
        </span>
      )}
    </div>
  );
  return (
    <div className={css.prices}>
      {shown.map((row) => line(row))}
      {prices.length > shown.length && (
        <Popover
          trigger="click"
          placement="bottom"
          title={t('otherPrices')}
          content={<div className={css.popover}>{prices.map((row) => line(row, true))}</div>}
        >
          <Button type="link" size="small" className={css.more}>
            {t('more', { count: prices.length })}
          </Button>
        </Popover>
      )}
    </div>
  );
}
