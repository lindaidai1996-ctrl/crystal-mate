'use client';

import { Alert, Pagination, Table, Typography } from 'antd';
import { useState } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LoadingImage } from '@/components/loadingImage';
import { imageStorageUrl, imageThumbnailUrl } from '@/lib/image-storage';
import type { AssistantBrowserResults } from '@/lib/ai-assistant/result-view';
import { assistantRecordHref } from '@/lib/ai-assistant/result-view';
import type { CatalogDisplay } from '@/lib/ai-assistant/display-data';
import type { SourceStock } from '@/lib/ai-assistant/stock-contracts';
import type { PurchaseEntry } from '@/lib/ai-assistant/purchase-contracts';
import assistantStyles from './assistantPage.module.css';
import { formatAssistantTime } from './displayTime';
import { AssistantSummary } from './assistantSummary';
import { AssistantUncertainPurchases } from './assistantUncertainPurchases';

export function AssistantResults({
  result,
  privacy,
  grouped = false,
}: {
  result: AssistantBrowserResults;
  privacy: boolean;
  grouped?: boolean;
}) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const key = (item: CatalogDisplay['item']) => `${item.type}:${item.id}`;
  const catalog = new Map(result.catalog.map((row) => [key(row.item), row]));
  const purchaseCatalog = new Map(
    result.catalog.filter((row) => row.purchase).map((row) => [row.purchase!.id, row]),
  );
  const stock = new Map(result.stock?.catalogStock.map((row) => [key(row.item), row]) ?? []);
  type Row = {
    id: string;
    item: CatalogDisplay['item'];
    detail?: CatalogDisplay;
    purchase?: PurchaseEntry;
    source?: SourceStock;
  };
  const rows: Row[] =
    result.kind === 'purchases'
      ? result.purchases.map((purchase) => ({
          id: purchase.purchase.id,
          item: purchase.item,
          detail: purchaseCatalog.get(purchase.purchase.id) ?? catalog.get(key(purchase.item)),
          purchase,
        }))
      : result.stockMode === 'purchase_remaining'
        ? (result.stock?.sourceStock ?? []).map((source) => ({
            id: source.purchase.id,
            item: source.item,
            source,
            detail: purchaseCatalog.get(source.purchase.id) ?? catalog.get(key(source.item)),
          }))
        : [...catalog.values()].map((detail) => ({
            id: key(detail.item),
            item: detail.item,
            detail,
          }));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const name = (row: Row) =>
    privacy
      ? t('privateText')
      : row.purchase?.name || row.detail?.name || row.source?.name || t('unknown');
  const specification = (row: Row) =>
    row.detail
      ? `${row.detail.lengthMm ?? '—'} × ${row.detail.widthMm ?? '—'} × ${row.detail.heightMm ?? '—'} mm`
      : t('unknown');
  const currentStock = (row: Row) => {
    if (row.source)
      return `${row.source.remainingQuantity ?? t('unknown')} ${t(`units.${row.source.unit}`)}`;
    const value = stock.get(key(row.item));
    return value ? (
      <>
        {value.knownStock} {t(`units.${value.unit}`)}
        {value.unknownStockBatchCount > 0 && (
          <span> · {t('unknownBatches', { count: value.unknownStockBatchCount })}</span>
        )}
      </>
    ) : (
      t('unknown')
    );
  };
  const quantity = (row: Row) =>
    row.purchase
      ? `${row.purchase.quantity ?? t('unknown')} ${t(`units.${row.purchase.unit}`)}`
      : row.source
        ? `${row.source.purchasedQuantity ?? t('unknown')} ${t(`units.${row.source.unit}`)}`
        : t('notApplicable');
  const amount = (row: Row) =>
    row.purchase?.amount === null || !row.purchase
      ? t('unknown')
      : `${row.purchase.currency ?? t('unknownCurrency')} ${row.purchase.amount}`;
  const record = (row: Row) => (
    <div className={assistantStyles.record}>
      {row.detail?.imageKey ? (
        <LoadingImage
          src={imageThumbnailUrl(imageStorageUrl(row.detail.imageKey, 'cos'))}
          alt={name(row)}
          width={48}
          height={48}
        />
      ) : (
        <span className={assistantStyles.noImage}>{t('noImage')}</span>
      )}
      <div>
        <Link href={assistantRecordHref(row.item, row.purchase?.purchase ?? row.source?.purchase)}>
          {name(row)}
        </Link>
        <small>{specification(row)}</small>
      </div>
    </div>
  );
  const columns: ColumnsType<Row> = [
    { title: t('record'), key: 'record', render: (_, row) => record(row) },
    ...(result.kind === 'purchases'
      ? [
          {
            title: t('purchaseDate'),
            key: 'date',
            render: (_: unknown, row: Row) =>
              row.purchase
                ? formatAssistantTime(row.purchase.batch.receivedAt, locale)
                : t('unknown'),
          },
          {
            title: t('distributor'),
            key: 'distributor',
            render: (_: unknown, row: Row) =>
              row.purchase && (
                <Link href={`/admin/distributors/${row.purchase.distributor.id}`}>
                  {privacy ? t('privateText') : row.purchase.distributor.name}
                </Link>
              ),
          },
          {
            title: t('purchasedQuantity'),
            key: 'quantity',
            render: (_: unknown, row: Row) => quantity(row),
          },
          ...(!privacy
            ? [
                {
                  title: t('purchaseAmount'),
                  key: 'amount',
                  render: (_: unknown, row: Row) => amount(row),
                },
              ]
            : []),
        ]
      : []),
    ...(result.stockMode === 'purchase_remaining'
      ? [
          {
            title: t('purchasedQuantity'),
            key: 'purchased',
            render: (_: unknown, row: Row) => quantity(row),
          },
        ]
      : []),
    {
      title: t(result.stockMode === 'purchase_remaining' ? 'sourceRemaining' : 'catalogStock'),
      key: 'stock',
      render: (_, row) => currentStock(row),
    },
  ];
  if (result.kind === 'distributors') {
    const group = (
      label: string,
      values: NonNullable<AssistantBrowserResults['distributors']>['confirmed'],
    ) => (
      <section>
        <Typography.Title level={5}>
          {label} ({values.length})
        </Typography.Title>
        {values.map((row) => (
          <article key={row.distributor.id} className={assistantStyles.resultCard}>
            <Link href={`/admin/distributors/${row.distributor.id}`}>
              {privacy ? t('privateText') : row.name}
            </Link>
            {!privacy && (
              <>
                <p>
                  {row.area} · {t(`locationReasons.${row.reason}`)}
                </p>
                <p>{row.evidence.map((e) => e.matchedText).join(' · ')}</p>
              </>
            )}
          </article>
        ))}
      </section>
    );
    return (
      <section className={assistantStyles.results} aria-label={t('results')}>
        <Typography.Title level={4}>{t('distributorResults')}</Typography.Title>
        <p className={assistantStyles.muted}>
          {t('observedAt')} {formatAssistantTime(result.queriedAt, locale)}
        </p>
        {result.selectionIsPartial && <Alert type="warning" message={t('uncertainDistributors')} />}
        {group(t('confirmedDistributors'), result.distributors?.confirmed ?? [])}
        {group(t('uncertainDistributorsTitle'), result.distributors?.uncertain ?? [])}
      </section>
    );
  }
  return (
    <section className={assistantStyles.results} aria-label={t('results')}>
      <Typography.Title level={4}>{t('results')}</Typography.Title>
      {result.selectionIsPartial && <Alert type="warning" message={t('uncertainSummary')} />}
      <AssistantSummary result={result} privacy={privacy} grouped={grouped} />
      {result.uncertainPurchases && (
        <AssistantUncertainPurchases pending={result.uncertainPurchases} privacy={privacy} />
      )}
      <p className={assistantStyles.muted}>
        {t('resultCount', { count: rows.length })} · {t('observedAt')}{' '}
        {formatAssistantTime(result.queriedAt, locale)}
      </p>
      {result.legacyDetails && <Alert type="info" message={t('legacyDetails')} />}
      <div className={assistantStyles.desktopResults}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={visibleRows}
          pagination={false}
          size="small"
          tableLayout="fixed"
          locale={{ emptyText: t('emptyResults') }}
        />
      </div>
      <div className={assistantStyles.mobileResults}>
        {visibleRows.map((row) => (
          <article key={row.id} className={assistantStyles.resultCard}>
            {record(row)}
            <dl>
              {row.purchase && (
                <>
                  <dt>{t('purchaseDate')}</dt>
                  <dd>{formatAssistantTime(row.purchase.batch.receivedAt, locale)}</dd>
                  <dt>{t('distributor')}</dt>
                  <dd>
                    <Link href={`/admin/distributors/${row.purchase.distributor.id}`}>
                      {privacy ? t('privateText') : row.purchase.distributor.name}
                    </Link>
                  </dd>
                  <dt>{t('purchasedQuantity')}</dt>
                  <dd>{quantity(row)}</dd>
                  {!privacy && (
                    <>
                      <dt>{t('purchaseAmount')}</dt>
                      <dd>{amount(row)}</dd>
                    </>
                  )}
                </>
              )}
              {row.source && (
                <>
                  <dt>{t('purchasedQuantity')}</dt>
                  <dd>{quantity(row)}</dd>
                </>
              )}
              <dt>
                {t(result.stockMode === 'purchase_remaining' ? 'sourceRemaining' : 'catalogStock')}
              </dt>
              <dd>{currentStock(row)}</dd>
            </dl>
          </article>
        ))}
      </div>
      <Pagination
        current={currentPage}
        pageSize={pageSize}
        total={rows.length}
        showSizeChanger
        pageSizeOptions={[5, 10, 20]}
        onChange={(nextPage, nextSize) => {
          setPage(nextPage);
          setPageSize(nextSize);
        }}
        responsive
      />
      <p className={assistantStyles.muted}>
        {t(result.stockMode === 'purchase_remaining' ? 'sourceStockBasis' : 'stockBasis')}
        {result.stock ? ` · ${formatAssistantTime(result.stock.queriedAt, locale)}` : ''}
      </p>
    </section>
  );
}
