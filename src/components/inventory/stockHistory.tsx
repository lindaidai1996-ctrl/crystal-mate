'use client';

import { Empty } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import type { ProductStockAdjustment, StockAdjustment } from '@/lib/client-types';
import inventoryStyles from './inventory.module.css';

export function StockHistory({
  records,
}: {
  records: (StockAdjustment | ProductStockAdjustment)[];
}) {
  const t = useTranslations('inventory');
  const locale = useLocale();
  return (
    <section className={inventoryStyles.history} aria-label={t('history')}>
      <h3>{t('history')}</h3>
      {records.length ? (
        records.map((record) => (
          <article className={inventoryStyles.record} key={record.id}>
            <strong>
              {record.afterQty != null
                ? `${record.beforeQty ?? t('unknown')} → ${record.afterQty}`
                : t('legacyAdjustment')}
              {record.delta !== null && ` (${record.delta > 0 ? '+' : ''}${record.delta})`}
            </strong>
            <time dateTime={record.createdAt}>
              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(record.createdAt),
              )}
            </time>
            <span>{record.reason}</span>
          </article>
        ))
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noHistory')} />
      )}
    </section>
  );
}
