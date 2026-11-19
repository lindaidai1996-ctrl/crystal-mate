'use client';

import { ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Result, Segmented, Select, Skeleton, Space, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { withAdminReturnTo } from '@/lib/admin-return-path';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  BatchComparison,
  ComparisonBatch,
  ComparisonEntry,
  ComparisonKind,
  ComparisonUnit,
} from '@/lib/batch-comparison-contracts';
import type { DateRange } from '@/lib/date-range';
import { formatAmount } from '@/lib/format-money';
import { DateRangeFilter } from '@/components/date-range-filter';
import { PaginatedTable } from '@/components/paginated-table';
import { usePrivacyMode } from '@/components/privacyMode';
import { BatchTrendChart } from './batchTrendChart';
import comparisonStyles from './batchComparison.module.css';

const money = (value: string | null) => (value === null ? '—' : `¥${formatAmount(value)}`);

export function ComparisonContent({
  data,
  comparisonPath,
}: {
  data: BatchComparison;
  comparisonPath: string;
}) {
  const t = useTranslations('batchComparison');
  const privacy = usePrivacyMode();
  const [chosenUnit, setChosenUnit] = useState<ComparisonUnit>(data.item.unit);
  const [barMetric, setBarMetric] = useState<'quantity' | 'amount'>('quantity');
  const units = (Object.keys(data.summary.prices) as ComparisonUnit[]).filter(
    (unit) => unit === data.item.unit || data.batches.some((batch) => batch.prices[unit] != null),
  );
  const unit = units.includes(chosenUnit) ? chosenUnit : data.item.unit;
  const summary = data.summary;
  const priceSummary = summary.prices[unit];
  const amountChart = !privacy && barMetric === 'amount';
  const batchLink = (batch: ComparisonBatch) =>
    withAdminReturnTo(`/admin/materials/batches/${encodeURIComponent(batch.id)}`, comparisonPath);
  const unitText = (value: ComparisonUnit) => t(`unit_${value}`);
  function metric(label: string, value: ReactNode, note?: ReactNode) {
    return (
      <div className={comparisonStyles.metric} key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
        {note && <small>{note}</small>}
      </div>
    );
  }
  function sourceDetails(entry: ComparisonEntry) {
    return (
      <div className={comparisonStyles.source} key={entry.id}>
        <Link href={withAdminReturnTo(entry.href, comparisonPath)}>
          {entry.distributor.name} · {t('viewRecord')}
        </Link>
        <span>
          {t('quantity')}: {formatAmount(entry.quantity)} {unitText(data.item.unit)}
        </span>
        {!privacy && (
          <span>
            {t('amount')}: {money(entry.amount)} · {t('price')}: {money(entry.prices[unit] ?? null)}{' '}
            / {unitText(unit)} · {t(`source_${entry.priceSource}` as never)}
          </span>
        )}
        {entry.dimensions && (
          <span>
            {t('dimensions')}:{' '}
            {[entry.dimensions.lengthMm, entry.dimensions.widthMm, entry.dimensions.heightMm]
              .map((value) => formatAmount(value))
              .join(' × ')}{' '}
            mm · {t('beadsPerUnit')}: {entry.dimensions.childCount ?? '—'} · {t('weightPerUnit')}:{' '}
            {formatAmount(entry.dimensions.weightGrams)} g
          </span>
        )}
        {data.item.kind === 'material' && (
          <span>
            {t('currentRemaining')}: {formatAmount(entry.remainingQuantity)}{' '}
            {unitText(data.item.unit)} · {t('remainingPercent')}:{' '}
            {entry.remainingPercent === null ? '—' : `${formatAmount(entry.remainingPercent)}%`}
          </span>
        )}
        {data.item.kind === 'material' && !privacy && (
          <span>
            {t('inventoryValue')}: {money(entry.inventoryValue)}
          </span>
        )}
        {entry.notes && (
          <span>
            {t('notes')}: {entry.notes}
          </span>
        )}
      </div>
    );
  }
  const columns: ColumnsType<ComparisonBatch> = [
    {
      title: t('batch'),
      key: 'batch',
      width: 180,
      render: (_, batch) => <Link href={batchLink(batch)}>{batch.name}</Link>,
    },
    { title: t('receivedAt'), dataIndex: 'receivedAt', width: 120 },
    {
      title: t('distributor'),
      key: 'distributor',
      width: 160,
      render: (_, batch) =>
        [...new Set(batch.entries.map((entry) => entry.distributor.name))].join(' / '),
    },
    {
      title: `${t('quantity')} (${unitText(data.item.unit)})`,
      key: 'quantity',
      width: 130,
      render: (_, batch) => formatAmount(batch.quantity),
    },
    ...(!privacy
      ? [
          {
            title: t('amount'),
            key: 'amount',
            width: 130,
            render: (_: unknown, batch: ComparisonBatch) => money(batch.amount),
          },
          {
            title: `${t('price')} (¥/${unitText(unit)})`,
            key: 'price',
            width: 150,
            render: (_: unknown, batch: ComparisonBatch) => money(batch.prices[unit] ?? null),
          },
        ]
      : []),
    ...(data.item.kind === 'material'
      ? [
          {
            title: t('currentRemaining'),
            key: 'remaining',
            width: 130,
            render: (_: unknown, batch: ComparisonBatch) =>
              formatAmount(batch.entries[0].remainingQuantity),
          },
          {
            title: t('remainingPercent'),
            key: 'ratio',
            width: 130,
            render: (_: unknown, batch: ComparisonBatch) =>
              batch.entries[0].remainingPercent === null
                ? '—'
                : `${formatAmount(batch.entries[0].remainingPercent)}%`,
          },
        ]
      : []),
  ];

  return (
    <>
      {privacy && <Alert type="info" message={t('privacyHint')} showIcon />}
      <dl className={comparisonStyles.metrics}>
        {metric(
          t('batchCount'),
          summary.batchCount,
          t('totalBatches', { count: data.totalBatchCount }),
        )}
        {metric(
          t('quantity'),
          `${formatAmount(summary.quantity.known)} ${unitText(data.item.unit)}`,
          t('missing', { count: summary.quantity.missingCount }),
        )}
        {!privacy &&
          metric(
            t('amount'),
            money(summary.amount.known),
            t('missing', { count: summary.amount.missingCount }),
          )}
        {!privacy &&
          metric(
            t('weightedMean'),
            `${money(priceSummary?.weightedMean ?? null)} / ${unitText(unit)}`,
            t('eligibleBatches', { count: priceSummary?.eligibleBatchCount ?? 0 }),
          )}
        {!privacy &&
          metric(
            t('priceChange'),
            priceSummary?.changePercent == null
              ? '—'
              : `${formatAmount(priceSummary.changePercent)}%`,
            t('latestTwo'),
          )}
        {metric(
          t('averageInterval'),
          summary.averageIntervalDays === null
            ? '—'
            : t('days', { count: formatAmount(summary.averageIntervalDays) }),
        )}
        {metric(
          data.item.kind === 'material' ? t('currentRemaining') : t('productStock'),
          `${formatAmount(summary.currentStock.known)} ${unitText(data.item.unit)}`,
          t('missing', { count: summary.currentStock.missingCount }),
        )}
        {!privacy &&
          summary.inventoryValue &&
          metric(
            t('inventoryValue'),
            money(summary.inventoryValue.known),
            t('missing', { count: summary.inventoryValue.missingCount }),
          )}
      </dl>
      {data.item.kind === 'material' && (
        <Alert
          type="info"
          showIcon
          message={t('currentStockHint')}
          description={
            summary.oldestRemainingBatch
              ? t('oldestBatch', {
                  name: summary.oldestRemainingBatch.name,
                  days: summary.oldestRemainingBatch.days,
                })
              : t('noRemainingBatch')
          }
        />
      )}
      {data.item.kind === 'product' && (
        <Alert type="info" showIcon message={t('productStockHint')} />
      )}
      {!data.batches.length ? (
        <Empty description={t('empty')} />
      ) : (
        <>
          {data.batches.length === 1 && <Alert type="info" message={t('singleBatch')} />}
          <div className={comparisonStyles.charts}>
            {!privacy && (
              <section className={comparisonStyles.panel}>
                <div className={comparisonStyles.panelHeading}>
                  <h2>{t('priceTrend')}</h2>
                  <Select
                    aria-label={t('priceUnit')}
                    value={unit}
                    onChange={setChosenUnit}
                    options={units.map((value) => ({ value, label: `¥/${unitText(value)}` }))}
                  />
                </div>
                <BatchTrendChart
                  key={`price:${unit}`}
                  label={`${t('priceTrend')} (¥/${unitText(unit)})`}
                  suffix={`¥/${unitText(unit)}`}
                  points={data.batches.map((batch) => ({
                    id: batch.id,
                    name: batch.name,
                    date: batch.receivedAt,
                    value: batch.prices[unit] ?? null,
                  }))}
                />
                <p className={comparisonStyles.hint}>{t('priceHint')}</p>
              </section>
            )}
            <section className={comparisonStyles.panel}>
              <div className={comparisonStyles.panelHeading}>
                <h2>{amountChart ? t('amountTrend') : t('quantityTrend')}</h2>
                {!privacy && (
                  <Segmented
                    aria-label={t('barMetric')}
                    value={barMetric}
                    options={[
                      { value: 'quantity', label: t('quantity') },
                      { value: 'amount', label: t('amount') },
                    ]}
                    onChange={(value) => setBarMetric(value === 'amount' ? 'amount' : 'quantity')}
                  />
                )}
              </div>
              <BatchTrendChart
                key={amountChart ? 'amount' : 'quantity'}
                bars
                label={amountChart ? t('amountTrend') : t('quantityTrend')}
                suffix={amountChart ? '¥' : unitText(data.item.unit)}
                points={data.batches.map((batch) => ({
                  id: batch.id,
                  name: batch.name,
                  date: batch.receivedAt,
                  value: amountChart ? batch.amount : batch.quantity,
                }))}
              />
            </section>
          </div>
          <section className={`${comparisonStyles.panel} ${comparisonStyles.details}`}>
            <div className={comparisonStyles.panelHeading}>
              <h2>{t('details')}</h2>
              <Tag>{t('currencyHint')}</Tag>
            </div>
            <p className={comparisonStyles.hint}>{t('detailsHint')}</p>
            <PaginatedTable
              rowKey="id"
              dataSource={[...data.batches].reverse()}
              columns={columns}
              scroll={{ x: 'max-content' }}
              expandable={{
                expandedRowRender: (batch) => (
                  <div className={comparisonStyles.details}>{batch.entries.map(sourceDetails)}</div>
                ),
              }}
            />
          </section>
        </>
      )}
    </>
  );
}

export function BatchComparisonPage({
  kind,
  id,
  returnTo,
}: {
  kind: ComparisonKind;
  id: string;
  returnTo?: string;
}) {
  const t = useTranslations('batchComparison');
  const common = useTranslations('common');
  const [range, setRange] = useState<DateRange>(null);
  const [distributorId, setDistributorId] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<BatchComparison>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const base = `/admin/${kind === 'material' ? 'materials' : 'products'}/${encodeURIComponent(id)}`;
  const back = returnTo ?? base;
  const comparisonPath = withAdminReturnTo(`${base}/batch-comparison`, back);
  const params = new URLSearchParams();
  if (range) {
    params.set('receivedFrom', range[0]);
    params.set('receivedTo', range[1]);
  }
  if (distributorId) params.set('distributorId', distributorId);
  const query = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<BatchComparison>(
      `/api/${kind === 'material' ? 'materials' : 'products'}/${encodeURIComponent(id)}/batch-comparison?${query}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setError(undefined);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof ClientApiError ? reason.code : 'SERVER_ERROR');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, id, query, revision]);
  function reload() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  return (
    <div className={comparisonStyles.page}>
      <div className={comparisonStyles.heading}>
        <div>
          <Link href={back} className="back-link">
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>
            {t('title')}
            {data ? ` · ${data.item.name}` : ''}
          </h1>
          <p>{t('subtitle')}</p>
        </div>
        <Space wrap>
          <Link href={base}>
            <Button>{t(kind === 'material' ? 'viewMaterial' : 'viewProduct')}</Button>
          </Link>
          <Button onClick={reload} disabled={loading}>
            {t('refresh')}
          </Button>
        </Space>
      </div>
      <div className={comparisonStyles.filters}>
        <DateRangeFilter
          kind="received"
          value={range}
          onChange={(value) => {
            if (value?.join('|') === range?.join('|')) return;
            setLoading(true);
            setRange(value);
          }}
        />
        <Select
          className={comparisonStyles.distributor}
          aria-label={t('distributor')}
          placeholder={t('allDistributors')}
          allowClear
          showSearch
          optionFilterProp="label"
          value={distributorId}
          options={data?.distributors.map((value) => ({ value: value.id, label: value.name }))}
          onChange={(value) => {
            if (value === distributorId) return;
            setLoading(true);
            setDistributorId(value);
          }}
        />
        <Button
          disabled={!range && !distributorId}
          onClick={() => {
            setLoading(true);
            setRange(null);
            setDistributorId(undefined);
          }}
        >
          {t('reset')}
        </Button>
      </div>
      {loading && <Skeleton active paragraph={{ rows: 10 }} />}
      {!loading && error && (
        <Result
          status={error === 'NOT_FOUND' ? '404' : 'error'}
          title={common(`errors.${error}` as never)}
          extra={<Button onClick={reload}>{t('retry')}</Button>}
        />
      )}
      <div hidden={loading || Boolean(error)} className={comparisonStyles.page}>
        {data && (
          <ComparisonContent
            key={`${data.item.kind}:${data.item.id}`}
            data={data}
            comparisonPath={comparisonPath}
          />
        )}
      </div>
    </div>
  );
}
