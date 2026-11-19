'use client';

import { useEffect, useState } from 'react';
import { Button, Empty, Input, Result, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/client-api';
import type {
  DistributorBatchEntry,
  DistributorBatchEntriesPage,
  DistributorBatchPage,
  DistributorBatchSummary,
} from '@/lib/client-types';
import { withAdminReturnTo } from '@/lib/admin-return-path';
import { coverFirstAttachments } from '@/lib/attachments';
import { formatAmount } from '@/lib/format-money';
import type { DateRange } from '@/lib/date-range';
import { DateRangeFilter } from './date-range-filter';
import { Sensitive } from './privacyMode';
import { MobileTableFields, PaginatedTable } from './paginated-table';
import { MobileDetails } from './responsive/mobileDetails';
import mobileStyles from './responsive/responsive.module.css';
import { SearchFilterRow } from './responsive/searchFilterRow';
import { ResetFiltersButton } from './responsive/resetFiltersButton';
import { ImageHoverPreview } from './materialManagement/imageHoverPreview';
import styles from './distributorBatches.module.css';
import { useSessionListState } from './useSessionListState';
import { ListLoadingIndicator } from './listLoadingIndicator';

const pagination = { pageSizeOptions: [10, 20, 50], showSizeChanger: true };

function useReadPage<T>(url: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${url}:${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: T; failed?: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    apiFetch<T>(url).then(
      (data) => {
        if (active) setResult({ key, data });
      },
      () => {
        if (active) setResult({ key, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [url, key]);
  return {
    data: result?.key === key ? result.data : undefined,
    failed: result?.key === key && result.failed,
    loading: result?.key !== key,
    retry: () => setAttempt((value) => value + 1),
  };
}

function BatchEntries({ id, batchId }: { id: string; batchId: string }) {
  const t = useTranslations('distributorDetail');
  const d = useTranslations('distributors');
  const common = useTranslations('common');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const result = useReadPage<DistributorBatchEntriesPage>(
    `/api/distributors/${id}/batches/${batchId}/entries?page=${page}&pageSize=${pageSize}`,
  );
  const unitLabel = (unit: string) =>
    unit === 'STRAND' || unit === 'BEAD' || unit === 'GRAM' ? d(`unit_${unit}`) : d('unit_piece');
  const columns: ColumnsType<DistributorBatchEntry> = [
    {
      title: t('type'),
      key: 'type',
      dataIndex: 'type',
      render: (value) => (
        <Tag color={value === 'PRODUCT' ? 'blue' : 'gold'}>
          {t(value === 'PRODUCT' ? 'product' : 'material')}
        </Tag>
      ),
    },
    {
      title: t('item'),
      key: 'item',
      render: (_, row) => (
        <Link
          href={withAdminReturnTo(
            row.type === 'PRODUCT'
              ? `/admin/products/${row.itemId}?sourceId=${row.id}`
              : `/admin/materials/${row.itemId}/batches/${row.id}`,
            `/admin/distributors/${id}?view=batches`,
          )}
        >
          {row.name}
          {row.code ? ` · ${row.code}` : ''}
        </Link>
      ),
    },
    {
      title: t('quantity'),
      key: 'quantity',
      render: (_, row) =>
        row.quantity === null
          ? t('quantityUnknown', { unit: unitLabel(row.unit) })
          : `${row.quantity} ${unitLabel(row.unit)}`,
    },
    {
      title: t('unitPrice'),
      key: 'unitPrice',
      dataIndex: 'unitPrice',
      render: (value) => <Sensitive>{formatAmount(value, t('unknownValue'))}</Sensitive>,
    },
    {
      title: t('amount'),
      key: 'amount',
      dataIndex: 'amount',
      render: (value) => <Sensitive>{formatAmount(value, t('unknownValue'))}</Sensitive>,
    },
  ];
  if (result.loading)
    return (
      <div className={styles.entriesLoading} role="status" aria-live="polite" aria-busy="true">
        <ListLoadingIndicator />
        <span>{common('loading')}</span>
      </div>
    );
  if (result.failed)
    return (
      <Result
        status="error"
        title={t('entriesLoadFailed')}
        extra={<Button onClick={result.retry}>{common('retry')}</Button>}
      />
    );
  return (
    <PaginatedTable
      rowKey={(row) => `${row.type}:${row.id}`}
      mobileRender={(row) => (
        <>
          <Tag color={row.type === 'PRODUCT' ? 'blue' : 'gold'}>
            {t(row.type === 'PRODUCT' ? 'product' : 'material')}
          </Tag>
          <MobileTableFields
            columns={columns.filter((column) => column.key === 'item')}
            record={row}
          />
          <MobileTableFields
            className={mobileStyles.recordMetrics}
            columns={columns.filter(
              (column) => column.key === 'quantity' || column.key === 'amount',
            )}
            record={row}
          />
          <MobileDetails>
            <MobileTableFields
              columns={columns.filter((column) => column.key === 'unitPrice')}
              record={row}
            />
          </MobileDetails>
        </>
      )}
      size="small"
      columns={columns}
      dataSource={result.data?.items ?? []}
      loading={result.loading}
      scroll={{ x: 760 }}
      pagination={{
        ...pagination,
        current: page,
        pageSize,
        total: result.data?.total ?? 0,
        onChange: (next, size) => {
          setPage(size === pageSize ? next : 1);
          setPageSize(size);
        },
      }}
      locale={{ emptyText: <Empty description={t('emptyEntries')} /> }}
    />
  );
}

export function DistributorBatches({ id }: { id: string }) {
  const t = useTranslations('distributorDetail');
  const d = useTranslations('distributors');
  const common = useTranslations('common');
  const prefix = `distributor-detail:${id}:batches`;
  const [query, setQuery] = useSessionListState(`${prefix}:query`, '');
  const [range, setRange] = useSessionListState<DateRange>(`${prefix}:range`, null);
  const [page, setPage] = useSessionListState(`${prefix}:page`, 1);
  const [pageSize, setPageSize] = useSessionListState(`${prefix}:pageSize`, 20);
  const [expanded, setExpanded] = useState<string[]>([]);
  const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) });
  if (range) {
    params.set('receivedFrom', range[0]);
    params.set('receivedTo', range[1]);
  }
  const result = useReadPage<DistributorBatchPage>(`/api/distributors/${id}/batches?${params}`);
  const batchPath = (batchId: string) =>
    withAdminReturnTo(
      `/admin/materials/batches/${batchId}?distributorId=${id}`,
      `/admin/distributors/${id}?view=batches`,
    );
  const resetPage = () => {
    setPage(1);
    setExpanded([]);
  };
  const columns: ColumnsType<DistributorBatchSummary> = [
    {
      title: t('batch'),
      key: 'name',
      render: (_, row) => (
        <div className="product-cell">
          <ImageHoverPreview
            images={coverFirstAttachments(row.attachments, row.coverObjectKey)}
            coverObjectKey={row.coverObjectKey}
            name={row.name}
          />
          <Link className="product-name" href={batchPath(row.id)}>
            {row.name}
          </Link>
        </div>
      ),
    },
    {
      title: t('receivedAt'),
      dataIndex: 'receivedAt',
      width: 130,
      render: (value: string) => value.slice(0, 10),
    },
    {
      title: t('supplierItems'),
      key: 'items',
      render: (_, row) =>
        `${d('products')} ${row.itemCounts.products} · ${d('materials')} ${row.itemCounts.materials}`,
    },
    {
      title: t('supplierAmount'),
      key: 'amount',
      render: (_, row) => (
        <Sensitive>
          {row.totalAmount === null
            ? t('unknownValue')
            : `${formatAmount(row.totalAmount)}${row.hasUnknownAmount ? ` · ${t('partialAmount')}` : ''}`}
        </Sensitive>
      ),
    },
    {
      title: d('actions'),
      key: 'actions',
      width: 110,
      render: (_, row) => <Link href={batchPath(row.id)}>{t('viewBatch')}</Link>,
    },
  ];
  return (
    <>
      <div className={styles.filters}>
        <SearchFilterRow>
          <Input.Search
            className="filter-search"
            aria-label={t('searchBatches')}
            placeholder={t('searchBatches')}
            value={query}
            maxLength={200}
            allowClear
            onChange={(event) => {
              setQuery(event.target.value);
              resetPage();
            }}
          />
          <ResetFiltersButton
            onReset={() => {
              setQuery('');
              setRange(null);
              resetPage();
              result.retry();
            }}
          />
        </SearchFilterRow>
        <DateRangeFilter
          kind="received"
          value={range}
          onChange={(value) => {
            setRange(value);
            resetPage();
          }}
        />
      </div>
      <div className="table-surface">
        {result.failed ? (
          <Result
            status="error"
            title={t('batchesLoadFailed')}
            extra={<Button onClick={result.retry}>{common('retry')}</Button>}
          />
        ) : (
          <PaginatedTable
            rowKey="id"
            mobileRender={(row) => (
              <>
                <div className={mobileStyles.recordIdentity}>
                  <ImageHoverPreview
                    images={coverFirstAttachments(row.attachments, row.coverObjectKey)}
                    coverObjectKey={row.coverObjectKey}
                    name={row.name}
                    hoverPreview={false}
                  />
                  <div>
                    <Link className="product-name" href={batchPath(row.id)}>
                      {row.name}
                    </Link>
                    <span className="mobile-record-meta">
                      {t('receivedAt')} · {row.receivedAt.slice(0, 10)}
                    </span>
                  </div>
                </div>
                <MobileTableFields
                  className={mobileStyles.recordMetrics}
                  columns={columns.filter(
                    (column) => column.key === 'items' || column.key === 'amount',
                  )}
                  record={row}
                />
                <div className="mobile-record-actions">
                  <Link href={batchPath(row.id)}>
                    <Button>{t('viewBatch')}</Button>
                  </Link>
                </div>
              </>
            )}
            dataSource={result.data?.items ?? []}
            columns={columns}
            loading={result.loading}
            scroll={{ x: 950 }}
            pagination={{
              ...pagination,
              current: page,
              pageSize,
              total: result.data?.total ?? 0,
              onChange: (next, size) => {
                setPage(size === pageSize ? next : 1);
                setPageSize(size);
                setExpanded([]);
              },
            }}
            expandable={{
              expandedRowKeys: expanded,
              onExpand: (open, row) =>
                setExpanded((current) =>
                  open ? [...current, row.id] : current.filter((key) => key !== row.id),
                ),
              expandedRowRender: (row) => (
                <BatchEntries key={`${row.id}:${params}`} id={id} batchId={row.id} />
              ),
            }}
            locale={{
              emptyText: (
                <Empty description={t(query || range ? 'noMatchingBatches' : 'emptyBatches')} />
              ),
            }}
          />
        )}
      </div>
    </>
  );
}
