'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Collapse, Empty, Segmented, Select, Spin, Table } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Decimal } from '@prisma/client/runtime/index-browser.js';
import { DateRangeFilter } from '@/components/date-range-filter';
import { BatchTrendChart } from '@/components/batchComparison/batchTrendChart';
import { Sensitive, usePrivacyMode } from '@/components/privacyMode';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { DateRange } from '@/lib/date-range';
import { formatAmount } from '@/lib/format-money';
import {
  analyzeProcurement,
  filterProcurementRows,
  procurementSupplierOptions,
  type ProcurementGranularity,
} from '@/lib/material-pricing/analytics';
import type { ProcurementCatalog } from '@/lib/material-pricing/purchase-service';
import { useMaterialPricingGroup } from './useMaterialPricingGroup';
import { MaterialPricingGroupSwitcher } from './materialPricingGroupSwitcher';
import { MaterialPricingNavigation } from './materialPricingNavigation';
import { ProcurementPieChart } from './procurementPieChart';
import analysisStyles from './procurementAnalytics.module.css';

type TrendMetric = 'weight' | 'amount' | 'actualPrice' | 'quotePrice';
type PriceMetric = 'actualPrice' | 'quotePrice' | 'latestActualPrice' | 'latestQuote';
const money = (value: string | null) => (value === null ? '—' : `¥${formatAmount(value)}`);

export function ProcurementAnalyticsPage({ initialGroupId }: { initialGroupId?: string }) {
  const t = useTranslations('procurementAnalytics');
  const ledger = useTranslations('silverProcurement');
  const pricing = useTranslations('materialPricing');
  const common = useTranslations('common');
  const { groupId, selectGroup: changeGroup } = useMaterialPricingGroup(initialGroupId);
  const privacy = usePrivacyMode();
  const [data, setData] = useState<ProcurementCatalog>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [supplier, setSupplier] = useState('');
  const [dates, setDates] = useState<DateRange>(null);
  const [granularity, setGranularity] = useState<ProcurementGranularity>('month');
  const [metric, setMetric] = useState<TrendMetric>('weight');
  const [shareMetric, setShareMetric] = useState<'weight' | 'amount'>('weight');
  const [priceMetric, setPriceMetric] = useState<PriceMetric>('actualPrice');
  const group = data?.groups.find((item) => item.id === groupId)?.id ?? data?.groups[0]?.id;
  const refresh = () => {
    setLoading(true);
    setRevision((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ProcurementCatalog>('/api/material-pricing-purchases', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setError('');
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          const code = cause instanceof ClientApiError ? cause.code : 'SERVER_ERROR';
          setError(
            ledger.has(`errors.${code}`)
              ? ledger(`errors.${code}`)
              : common.has(`errors.${code}`)
                ? common(`errors.${code}`)
                : common('errors.SERVER_ERROR'),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, ledger, common]);
  const scoped = useMemo(
    () => filterProcurementRows(data?.items ?? [], { groupId: group, dates }),
    [data, group, dates],
  );
  const suppliers = useMemo(() => procurementSupplierOptions(scoped), [scoped]);
  const activeSupplier = suppliers.some((item) => item.value === supplier) ? supplier : '';
  const rows = useMemo(
    () => filterProcurementRows(scoped, { distributorId: activeSupplier }),
    [scoped, activeSupplier],
  );
  const analysis = useMemo(() => analyzeProcurement(rows, granularity), [rows, granularity]);
  const mixedGroups = analysis.groupShares.length > 1;
  const privateMetric = metric !== 'weight';
  const trendUnit = t(metric === 'weight' ? 'grams' : metric === 'amount' ? 'yuan' : 'yuanPerGram');
  const priceRows = [...analysis.suppliers].sort((a, b) => {
    const left = a[priceMetric],
      right = b[priceMetric];
    return left === null
      ? right === null
        ? 0
        : 1
      : right === null
        ? -1
        : new Decimal(left).cmp(right);
  });
  const metricLabel = (key: string) => t(key);
  const summary = (label: string, value: string, sensitive = false) => {
    const element = (
      <div key={label} className={analysisStyles.metric}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    );
    return sensitive ? <Sensitive key={label}>{element}</Sensitive> : element;
  };
  return (
    <div className={analysisStyles.page}>
      <div className="page-heading">
        <div>
          <h1>{pricing('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
          {ledger('refresh')}
        </Button>
      </div>
      <MaterialPricingGroupSwitcher
        groups={data?.groups ?? []}
        selected={group}
        loading={loading}
        onChange={changeGroup}
      />
      <MaterialPricingNavigation active="analytics" groupId={group} />
      <div className={analysisStyles.filters}>
        <Select
          aria-label={ledger('supplier')}
          placeholder={t('allSuppliers')}
          allowClear
          showSearch
          optionFilterProp="label"
          value={activeSupplier || undefined}
          options={suppliers}
          onChange={(value) => setSupplier(value ?? '')}
        />
        <DateRangeFilter
          kind="received"
          label={ledger('date')}
          endpointLabels={[ledger('from'), ledger('to')]}
          value={dates}
          onChange={setDates}
        />
        <Button
          onClick={() => {
            setSupplier('');
            setDates(null);
          }}
        >
          {ledger('reset')}
        </Button>
      </div>
      <p className={analysisStyles.hint}>{t('scopeHint')}</p>
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          action={<Button onClick={refresh}>{ledger('refresh')}</Button>}
        />
      ) : loading ? (
        <div className={analysisStyles.loading}>
          <Spin />
        </div>
      ) : !rows.length ? (
        <Empty description={t('empty')} />
      ) : (
        <>
          <dl className={analysisStyles.metrics}>
            {summary(t('purchaseRows'), String(analysis.totals.count))}
            {summary(t('weight'), `${formatAmount(analysis.totals.weight)} ${t('grams')}`)}
            {summary(t('amount'), money(analysis.totals.amount), true)}
            {summary(t('supplierCount'), String(analysis.supplierShares.length))}
          </dl>
          {(analysis.totals.unknownWeight > 0 || analysis.totals.unknownAmount > 0) && (
            <Alert
              type="warning"
              showIcon
              message={t('incomplete', {
                weight: analysis.totals.unknownWeight,
                amount: analysis.totals.unknownAmount,
              })}
            />
          )}
          {privacy && <Alert type="info" showIcon message={t('privacy')} />}
          <section className={analysisStyles.panel}>
            <div className={analysisStyles.panelHeading}>
              <h2>{t('trend')}</h2>
              <Segmented
                aria-label={t('granularity')}
                value={granularity}
                onChange={setGranularity}
                options={(['day', 'month', 'year'] as const).map((value) => ({
                  value,
                  label: t(value),
                }))}
              />
            </div>
            <div className={analysisStyles.chartControls}>
              <Select
                aria-label={t('trendMetric')}
                value={privacy ? 'weight' : metric}
                options={(privacy
                  ? ['weight']
                  : ['weight', 'amount', 'actualPrice', 'quotePrice']
                ).map((value) => ({ value, label: metricLabel(value) }))}
                onChange={setMetric}
              />
              <span className={analysisStyles.hint}>{t('trendHint')}</span>
            </div>
            {mixedGroups && !privacy && ['actualPrice', 'quotePrice'].includes(metric) ? (
              <Alert type="info" showIcon message={t('chooseGroupForPrice')} />
            ) : (
              <>
                {privateMetric && !privacy ? (
                  <Sensitive>
                    <BatchTrendChart
                      hint={t('chartInteraction')}
                      calendarScale
                      points={analysis.periods.map((period) => ({
                        id: period.key,
                        date: period.key,
                        name: t(metric),
                        value: period[metric],
                      }))}
                      label={t(metric)}
                      suffix={trendUnit}
                      bars={metric === 'amount'}
                    />
                  </Sensitive>
                ) : (
                  <BatchTrendChart
                    hint={t('chartInteraction')}
                    calendarScale
                    points={analysis.periods.map((period) => ({
                      id: period.key,
                      date: period.key,
                      name: t('weight'),
                      value: period.weight,
                    }))}
                    label={t('weight')}
                    suffix={t('grams')}
                    bars
                  />
                )}
              </>
            )}
          </section>
          <div className={analysisStyles.panelHeading}>
            <h2 className={analysisStyles.sectionTitle}>{t('composition')}</h2>
            <Segmented
              aria-label={t('shareMetric')}
              value={privacy ? 'weight' : shareMetric}
              onChange={setShareMetric}
              options={(privacy ? (['weight'] as const) : (['weight', 'amount'] as const)).map(
                (value) => ({
                  value,
                  label: t(value),
                }),
              )}
            />
          </div>
          <div className={analysisStyles.pies}>
            {(['supplierShares', 'groupShares'] as const).map((key) => {
              const title = t(key === 'supplierShares' ? 'supplierShare' : 'groupShare');
              const current = privacy ? 'weight' : shareMetric;
              const content = (
                <ProcurementPieChart
                  label={title}
                  unit={t(current === 'weight' ? 'grams' : 'yuan')}
                  items={analysis[key].map((item) => ({
                    key: item.key,
                    name: item.name,
                    value: item[current],
                  }))}
                />
              );
              return (
                <section className={analysisStyles.panel} key={key}>
                  <h2>{title}</h2>
                  {current === 'amount' ? <Sensitive>{content}</Sensitive> : content}
                </section>
              );
            })}
          </div>
          <p className={analysisStyles.hint}>{t('shareHint')}</p>
          <Sensitive>
            <section className={analysisStyles.panel}>
              <div className={analysisStyles.panelHeading}>
                <h2>{t('supplierPrices')}</h2>
                <Select
                  aria-label={t('priceMetric')}
                  value={priceMetric}
                  onChange={setPriceMetric}
                  options={['actualPrice', 'quotePrice', 'latestActualPrice', 'latestQuote'].map(
                    (value) => ({ value, label: t(value) }),
                  )}
                />
              </div>
              {mixedGroups ? (
                <Alert type="info" showIcon message={t('chooseGroupForPrice')} />
              ) : (
                <BatchTrendChart
                  hint={t('chartInteraction')}
                  bars
                  categoryAxis
                  points={priceRows
                    .filter((item) => item[priceMetric] !== null)
                    .map((item) => ({
                      id: item.key,
                      date: item.name,
                      name: t(priceMetric),
                      value: item[priceMetric],
                    }))}
                  label={t('supplierPrices')}
                  suffix={t('yuanPerGram')}
                />
              )}
              <p className={analysisStyles.hint}>{t('priceHint')}</p>
            </section>
          </Sensitive>
          <section className={analysisStyles.panel}>
            <div className={analysisStyles.panelHeading}>
              <h2>{t('supplierDetails')}</h2>
              <Link
                href={{
                  pathname: '/admin/material-pricing/purchases',
                  ...(group ? { query: { group } } : {}),
                }}
              >
                {t('openLedger')}
              </Link>
            </div>
            <div className={analysisStyles.table}>
              <Table
                size="small"
                rowKey="key"
                dataSource={analysis.suppliers}
                scroll={{ x: privacy ? 650 : 1400 }}
                pagination={{ defaultPageSize: 10, showSizeChanger: true }}
                columns={[
                  { title: ledger('supplier'), dataIndex: 'name', width: 140 },
                  { title: ledger('group'), dataIndex: 'groupName', width: 150 },
                  {
                    title: t('purchaseRows'),
                    dataIndex: 'count',
                    sorter: (a, b) => a.count - b.count,
                  },
                  {
                    title: t('weight'),
                    render: (_, row) => (
                      <>
                        {row.weight === null ? t('unknown') : formatAmount(row.weight)}
                        {row.weight !== null && row.unknownWeight > 0 ? ` + ${t('unknown')}` : ''}
                      </>
                    ),
                  },
                  ...(!privacy
                    ? [
                        {
                          title: t('amount'),
                          render: (_: unknown, row: (typeof analysis.suppliers)[number]) => (
                            <Sensitive>
                              {row.amount === null ? t('unknown') : money(row.amount)}
                              {row.amount !== null && row.unknownAmount > 0
                                ? ` + ${t('unknown')}`
                                : ''}
                            </Sensitive>
                          ),
                        },
                        ...(
                          [
                            'actualPrice',
                            'quotePrice',
                            'discount',
                            'latestActualPrice',
                            'latestQuote',
                          ] as const
                        ).map((key) => ({
                          title: t(key),
                          render: (_: unknown, row: (typeof analysis.suppliers)[number]) => (
                            <Sensitive>
                              {key === 'discount'
                                ? row.discount === null
                                  ? '—'
                                  : Number(row.discount) === 10
                                    ? ledger('noDiscount')
                                    : ledger('discountValue', { value: row.discount })
                                : money(row[key])}
                            </Sensitive>
                          ),
                        })),
                        {
                          title: t('priceSamples'),
                          render: (_: unknown, row: (typeof analysis.suppliers)[number]) => (
                            <Sensitive>
                              {row.priceCount} / {row.quoteCount}
                            </Sensitive>
                          ),
                        },
                      ]
                    : []),
                  { title: t('latestDate'), dataIndex: 'latestDate', width: 110 },
                ]}
              />
            </div>
          </section>
          <Collapse
            items={[
              {
                key: 'method',
                label: t('method'),
                children: (
                  <div className={analysisStyles.method}>
                    <p>{t('methodScope')}</p>
                    <p>{t('methodPrices')}</p>
                    <p>{t('methodQuotes')}</p>
                    <p>{t('methodMissing')}</p>
                    <p>{t('methodLatest')}</p>
                  </div>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
