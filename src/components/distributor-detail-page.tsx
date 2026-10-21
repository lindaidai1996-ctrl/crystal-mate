'use client';

import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import { App, Button, Descriptions, Empty, Input, Result, Segmented, Skeleton, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { PaginatedTable } from '@/components/paginated-table';
import { CreatePurchaseButton } from '@/components/purchaseCreation/createPurchaseButton';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  Distributor,
  DistributorDetailResponse,
  DistributorPurchaseEntriesPage,
  DistributorPurchaseEntry,
  DistributorPurchasePage,
  DistributorPurchaseSummary,
} from '@/lib/client-types';
import { DistributorEditorDrawer } from './distributor-editor-drawer';

type PurchaseType = 'all' | 'product' | 'material';

const pagination = { defaultPageSize: 20, pageSizeOptions: [10, 20, 50], showSizeChanger: true };

function dateLabel(value: string) {
  return value.slice(0, 10);
}

export function DistributorDetailPage({ id }: { id: string }) {
  const t = useTranslations('distributorDetail');
  const distributorT = useTranslations('distributors');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [distributor, setDistributor] = useState<Distributor | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<PurchaseType>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [purchasePage, setPurchasePage] = useState<DistributorPurchasePage | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(true);
  const [purchaseFailed, setPurchaseFailed] = useState(false);
  const [purchaseAttempt, setPurchaseAttempt] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [entryPages, setEntryPages] = useState<Record<string, DistributorPurchaseEntriesPage>>({});
  const [entryLoading, setEntryLoading] = useState<Record<string, boolean>>({});
  const [entryFailed, setEntryFailed] = useState<Record<string, boolean>>({});
  const requestVersion = useRef(0);
  const entryVersions = useRef<Record<string, number>>({});

  const errorMessage = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );

  useEffect(() => {
    let active = true;
    apiFetch<DistributorDetailResponse>(`/api/distributors/${id}`)
      .then((data) => {
        if (!active) return;
        setDistributor(data.item);
        setAreas(data.areas);
      })
      .catch((error) => {
        if (!active) return;
        setFailed(true);
        setNotFound(error instanceof ClientApiError && error.code === 'NOT_FOUND');
        message.error(errorMessage(error));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, message, errorMessage, detailAttempt]);

  useEffect(() => {
    const version = ++requestVersion.current;
    let active = true;
    apiFetch<DistributorPurchasePage>(
      `/api/distributors/${id}/purchases?type=${type}&q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`,
    )
      .then((data) => {
        if (!active || version !== requestVersion.current) return;
        setPurchasePage(data);
        setPurchaseFailed(false);
      })
      .catch((error) => {
        if (!active || version !== requestVersion.current) return;
        setPurchaseFailed(true);
        message.error(errorMessage(error));
      })
      .finally(() => active && version === requestVersion.current && setPurchaseLoading(false));
    return () => {
      active = false;
    };
  }, [id, type, query, page, pageSize, message, errorMessage, purchaseAttempt]);

  function clearExpanded() {
    entryVersions.current = {};
    setExpandedKeys([]);
    setEntryPages({});
    setEntryLoading({});
    setEntryFailed({});
  }

  function resetList(nextType = type) {
    setPurchaseLoading(true);
    setType(nextType);
    setPage(1);
    clearExpanded();
  }

  function loadEntries(row: DistributorPurchaseSummary, nextPage = 1, nextPageSize = 20) {
    const key = `${row.type}:${row.itemId}`;
    const versions = entryVersions.current;
    const version = (versions[key] ?? 0) + 1;
    versions[key] = version;
    const active = () => entryVersions.current === versions && versions[key] === version;
    setEntryLoading((current) => ({ ...current, [key]: true }));
    setEntryFailed((current) => ({ ...current, [key]: false }));
    const detailType = row.type === 'PRODUCT' ? 'product' : 'material';
    apiFetch<DistributorPurchaseEntriesPage>(
      `/api/distributors/${id}/purchases/entries?type=${detailType}&itemId=${row.itemId}&page=${nextPage}&pageSize=${nextPageSize}`,
    )
      .then((data) => {
        if (active()) setEntryPages((current) => ({ ...current, [key]: data }));
      })
      .catch((error) => {
        if (!active()) return;
        setEntryFailed((current) => ({ ...current, [key]: true }));
        message.error(errorMessage(error));
      })
      .finally(() => {
        if (active()) setEntryLoading((current) => ({ ...current, [key]: false }));
      });
  }

  function renderEntryTable(row: DistributorPurchaseSummary) {
    const key = `${row.type}:${row.itemId}`;
    const data = entryPages[key];
    if (entryFailed[key])
      return (
        <Result
          status="error"
          title={t('entriesLoadFailed')}
          extra={
            <Button onClick={() => loadEntries(row, data?.page ?? 1, data?.pageSize ?? 20)}>
              {common('retry')}
            </Button>
          }
        />
      );
    const columns: ColumnsType<DistributorPurchaseEntry> = [
      {
        title: t('batch'),
        key: 'batch',
        render: (_, entry) => (
          <Link href={`/admin/materials/batches/${entry.batchId}`}>{entry.batchName}</Link>
        ),
      },
      { title: t('receivedAt'), dataIndex: 'receivedAt', render: dateLabel },
      {
        title: t('quantity'),
        key: 'quantity',
        render: (_, entry) =>
          entry.quantity === null
            ? t('quantityUnknown', { unit: unitLabel(entry.unit) })
            : `${entry.quantity} ${unitLabel(entry.unit)}`,
      },
      {
        title: t('unitPrice'),
        dataIndex: 'unitPrice',
        render: (value: string | null) => value ?? '—',
      },
      {
        title: t('amount'),
        dataIndex: 'amount',
        render: (value: string | null) => value ?? t('unknownValue'),
      },
      ...(row.type === 'MATERIAL'
        ? ([
            {
              title: t('weightGrams'),
              dataIndex: 'weightGrams',
              render: (value: string | null) => (value ? `${value} g` : t('unknownValue')),
            },
            {
              title: t('gramPrice'),
              dataIndex: 'gramPrice',
              render: (value: string | null) => value ?? t('unknownValue'),
            },
            {
              title: t('priceSource'),
              dataIndex: 'priceSource',
              render: (value: string | null) =>
                value && value !== 'UNIT' ? t(`priceSource_${value}` as never) : '—',
            },
          ] as ColumnsType<DistributorPurchaseEntry>)
        : []),
    ];
    return (
      <PaginatedTable
        rowKey="id"
        size="small"
        loading={entryLoading[key]}
        dataSource={data?.items ?? []}
        columns={columns}
        pagination={
          data
            ? {
                ...pagination,
                current: data.page,
                pageSize: data.pageSize,
                total: data.total,
                onChange: (nextPage, nextPageSize) =>
                  loadEntries(row, nextPageSize === data.pageSize ? nextPage : 1, nextPageSize),
              }
            : false
        }
        locale={{ emptyText: <Empty description={t('emptyEntries')} /> }}
        scroll={{ x: 900 }}
      />
    );
  }

  function unitLabel(unit: string | null) {
    if (unit === 'STRAND' || unit === 'BEAD' || unit === 'GRAM')
      return distributorT(`unit_${unit}`);
    return distributorT('unit_piece');
  }

  const columns: ColumnsType<DistributorPurchaseSummary> = [
    {
      title: t('type'),
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (value: DistributorPurchaseSummary['type']) => (
        <Tag color={value === 'PRODUCT' ? 'blue' : 'gold'}>
          {value === 'PRODUCT' ? t('product') : t('material')}
        </Tag>
      ),
    },
    {
      title: t('item'),
      key: 'item',
      render: (_, row) => (
        <Link
          className="product-name"
          href={`/admin/${row.type === 'PRODUCT' ? 'products' : 'materials'}/${row.itemId}`}
        >
          {row.name}
          {row.code ? ` · ${row.code}` : ''}
        </Link>
      ),
    },
    { title: t('batchCount'), dataIndex: 'batchCount', key: 'batchCount', width: 90 },
    {
      title: t('latestReceivedAt'),
      dataIndex: 'latestReceivedAt',
      key: 'latestReceivedAt',
      width: 125,
      render: dateLabel,
    },
    {
      title: t('quantity'),
      key: 'quantity',
      width: 155,
      render: (_, row) =>
        row.knownQuantity === null
          ? t('quantityUnknown', { unit: unitLabel(row.unit) })
          : `${row.knownQuantity} ${unitLabel(row.unit)}${row.hasUnknownQuantity ? ` · ${t('knownSubtotal')}` : ''}`,
    },
    {
      title: t('amount'),
      key: 'amount',
      width: 130,
      render: (_, row) =>
        row.totalAmount
          ? `${row.totalAmount}${row.hasUnknownAmount ? ` · ${t('knownSubtotal')}` : ''}`
          : t('unknownValue'),
    },
    {
      title: t('weightGrams'),
      key: 'weightGrams',
      width: 130,
      render: (_, row) =>
        row.type === 'MATERIAL'
          ? row.totalWeightGrams
            ? `${row.totalWeightGrams} g${row.hasUnknownWeight ? ` · ${t('knownSubtotal')}` : ''}`
            : t('unknownValue')
          : '—',
    },
  ];

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (failed || !distributor)
    return (
      <Result
        status={notFound ? '404' : 'error'}
        title={notFound ? common('errors.NOT_FOUND') : t('loadFailed')}
        extra={
          notFound ? (
            <Link href="/admin/distributors">{t('back')}</Link>
          ) : (
            <Button
              onClick={() => {
                setFailed(false);
                setLoading(true);
                setDetailAttempt((attempt) => attempt + 1);
              }}
            >
              {common('retry')}
            </Button>
          )
        }
      />
    );

  return (
    <>
      <div className="page-heading editor-heading distributor-detail-heading">
        <div>
          <Link href="/admin/distributors" className="back-link">
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>{distributor.name}</h1>
          <p>{t('count', { count: purchasePage?.total ?? 0 })}</p>
        </div>
        <div className="page-heading-actions">
          <CreatePurchaseButton distributorId={distributor.id} />
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
            {common('edit')}
          </Button>
        </div>
      </div>
      <Descriptions
        className="material-batch-summary distributor-detail-summary"
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
      >
        <Descriptions.Item label={distributorT('area')}>
          {distributor.area === '东海'
            ? distributorT('donghai')
            : distributor.area === '可塘'
              ? distributorT('ketang')
              : distributor.area === '网络'
                ? distributorT('online')
                : distributor.area}
        </Descriptions.Item>
        <Descriptions.Item label={distributorT('address')}>
          {distributor.address || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={distributorT('wechat')}>
          {distributor.wechat || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={distributorT('phone')}>
          {distributor.phone || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={distributorT('notes')} span="filled">
          {distributor.notes || '—'}
        </Descriptions.Item>
      </Descriptions>
      <div className="filter-bar distributor-detail-filter">
        <Input.Search
          className="filter-search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={query}
          maxLength={200}
          onChange={(event) => {
            setPurchaseLoading(true);
            setQuery(event.target.value);
            setPage(1);
            clearExpanded();
          }}
          allowClear
        />
      </div>
      <div className="distributor-detail-type-filter">
        <Segmented<PurchaseType>
          value={type}
          onChange={(value) => resetList(value)}
          style={{ background: 'var(--ant-color-fill-tertiary)' }}
          options={[
            { value: 'all', label: t('all') },
            { value: 'product', label: t('productsOnly') },
            { value: 'material', label: t('materialsOnly') },
          ]}
        />
      </div>
      <div className="table-surface">
        {purchaseFailed ? (
          <Result
            status="error"
            title={t('purchasesLoadFailed')}
            extra={
              <Button
                onClick={() => {
                  setPurchaseLoading(true);
                  setPurchaseFailed(false);
                  setPurchaseAttempt((attempt) => attempt + 1);
                }}
              >
                {common('retry')}
              </Button>
            }
          />
        ) : (
          <PaginatedTable
            rowKey={(row) => `${row.type}:${row.itemId}`}
            dataSource={purchasePage?.items ?? []}
            columns={columns}
            loading={purchaseLoading}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpand: (expanded, row) => {
                const key = `${row.type}:${row.itemId}`;
                setExpandedKeys((current) =>
                  expanded ? [...current, key] : current.filter((item) => item !== key),
                );
                if (expanded && !entryPages[key]) loadEntries(row);
              },
              expandedRowRender: renderEntryTable,
            }}
            pagination={
              purchasePage
                ? {
                    ...pagination,
                    current: purchasePage.page,
                    pageSize: purchasePage.pageSize,
                    total: purchasePage.total,
                    onChange: (nextPage, nextPageSize) => {
                      setPurchaseLoading(true);
                      setPage(nextPageSize === pageSize ? nextPage : 1);
                      setPageSize(nextPageSize);
                      clearExpanded();
                    },
                  }
                : false
            }
            locale={{ emptyText: <Empty description={t('empty')} /> }}
            scroll={{ x: 1050 }}
          />
        )}
      </div>
      {editing && (
        <DistributorEditorDrawer
          distributor={distributor}
          areas={areas}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setDistributor(saved);
            setAreas((current) => [...new Set([...current, saved.area])]);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
