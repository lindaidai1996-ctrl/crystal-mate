'use client';

import {
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Cascader,
  Empty,
  Input,
  Pagination,
  Popconfirm,
  Popover,
  Skeleton,
  Table,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  MaterialBatchEntry,
  Material,
  MaterialCategory,
  MaterialPage,
} from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION, DEFAULT_TABLE_PAGE_SIZE } from '@/lib/table-pagination';
import { categoryPath, categoryTree } from './categoryTree';
import { ImageHoverPreview } from './imageHoverPreview';

function BatchPrices({ item }: { item: Material }) {
  const t = useTranslations('materialBatches');
  const entries = item.batchEntries;
  const priceText = (
    value: Pick<Material, 'purchaseUnitPrice' | 'purchaseGramPrice' | 'saleUnitPrice'> &
      Partial<Pick<MaterialBatchEntry, 'unitPriceSource'>>,
  ) =>
    [
      `${t('purchaseUnitPrice')}: ${value.purchaseUnitPrice ?? '—'}${value.unitPriceSource === 'ESTIMATED' || value.unitPriceSource === 'MANUAL' ? ` (${t(`priceSource_${value.unitPriceSource}`)})` : ''}`,
      `${t('gramPrice')}: ${value.purchaseGramPrice ?? '—'}`,
      `${t('salePrice')}: ${value.saleUnitPrice ?? '—'}`,
    ].join(' · ');
  if (!entries.length)
    return (
      <span className="material-price-summary">
        {t('unassigned')} · {priceText(item)}
      </span>
    );
  const samePrice = entries.every(
    (entry) =>
      entry.purchaseUnitPrice === entries[0].purchaseUnitPrice &&
      entry.purchaseGramPrice === entries[0].purchaseGramPrice &&
      entry.saleUnitPrice === entries[0].saleUnitPrice &&
      entry.unitPriceSource === entries[0].unitPriceSource,
  );
  const links = entries.map((entry) => (
    <Link
      key={entry.id}
      href={`/admin/materials/batches/${entry.batchId}`}
      className="material-batch-link"
    >
      {entry.batch.name}
    </Link>
  ));
  if (samePrice)
    return (
      <div className="material-batch-names">
        {links.slice(0, 2)}
        {entries.length > 2 && (
          <Popover
            title={t('batch')}
            content={<div className="material-batch-more">{links}</div>}
            trigger="click"
          >
            <Button type="link" size="small">
              {t('more', { count: entries.length - 2 })}
            </Button>
          </Popover>
        )}
        <span className="material-price-summary">{priceText(entries[0])}</span>
      </div>
    );
  return (
    <div className="material-batch-prices">
      {entries.map((entry) => (
        <div className="material-batch-price" key={entry.id}>
          <Link href={`/admin/materials/batches/${entry.batchId}`}>{entry.batch.name}</Link>
          <span>{priceText(entry)}</span>
        </div>
      ))}
    </div>
  );
}

function MaterialIdentity({ item }: { item: Material }) {
  const seen = new Set<string>();
  const images = [...item.batchEntries.flatMap((entry) => entry.images), ...item.images].filter(
    (image) => {
      if (seen.has(image.objectKey)) return false;
      seen.add(image.objectKey);
      return true;
    },
  );
  return (
    <div className="product-cell">
      <ImageHoverPreview images={images} name={item.name} />
      <Link className="product-name" href={`/admin/materials/${item.id}`}>
        {item.name}
      </Link>
    </div>
  );
}

function MaterialActions({ item, onRemove }: { item: Material; onRemove: (id: string) => void }) {
  const t = useTranslations('materials');
  const common = useTranslations('common');
  const editButton = (
    <Tooltip title={common('edit')}>
      <Button type="text" icon={<EditOutlined />} aria-label={`${common('edit')} ${item.name}`} />
    </Tooltip>
  );
  return (
    <span className="row-actions">
      {item.batchEntries.length > 1 ? (
        <Popover
          title={t('chooseEditBatch')}
          content={
            <div className="material-edit-batch-options">
              {item.batchEntries.map((entry) => (
                <Link key={entry.id} href={`/admin/materials/${item.id}/batches/${entry.id}`}>
                  {entry.batch.name}
                </Link>
              ))}
            </div>
          }
          trigger="click"
        >
          {editButton}
        </Popover>
      ) : (
        <Link href={`/admin/materials/${item.id}/batches/${item.batchEntries[0]?.id ?? 'new'}`}>
          {editButton}
        </Link>
      )}
      <Link href={`/admin/materials/${item.id}/batches/new`}>
        <Tooltip title={t('addBatch')}>
          <Button type="text" icon={<PlusOutlined />} aria-label={t('addBatch')} />
        </Tooltip>
      </Link>
      <Popconfirm
        title={t('deleteConfirm')}
        okText={common('delete')}
        cancelText={common('cancel')}
        onConfirm={() => onRemove(item.id)}
      >
        <Tooltip title={common('delete')}>
          <Button type="text" danger icon={<DeleteOutlined />} aria-label={common('delete')} />
        </Tooltip>
      </Popconfirm>
    </span>
  );
}

export function MaterialsPage({ initialQuery = '' }: { initialQuery?: string }) {
  const t = useTranslations('materials');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const search = useDeferredValue(query);
  const [categoryId, setCategoryId] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MaterialPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  });
  const errorText = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );

  useEffect(() => {
    apiFetch<MaterialCategory[]>('/api/material-categories')
      .then(setCategories)
      .catch((error) => message.error(errorText(error)));
  }, [errorText, message]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('q', search);
    if (categoryId) params.set('categoryId', categoryId);
    apiFetch<MaterialPage>(`/api/materials?${params}`, { signal: controller.signal })
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted) message.error(errorText(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, pageSize, search, categoryId, revision, errorText, message]);

  function changePage(nextPage: number, nextPageSize: number) {
    setLoading(true);
    setPage(nextPageSize === pageSize ? nextPage : 1);
    setPageSize(nextPageSize);
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/materials/${id}`, { method: 'DELETE' });
      message.success(common('deleted'));
      setLoading(true);
      setPage(1);
      setRevision((value) => value + 1);
    } catch (error) {
      message.error(errorText(error));
    }
  }

  const columns: ColumnsType<Material> = [
    {
      title: t('name'),
      key: 'name',
      render: (_, item) => <MaterialIdentity item={item} />,
    },
    {
      title: t('category'),
      key: 'category',
      render: (_, item) =>
        categoryPath(item.categoryId, categories)
          .map((id) => categories.find((category) => category.id === id)?.name)
          .join(' / ') || item.category.name,
    },
    { title: t('unit'), key: 'unit', width: 90, render: (_, item) => t(item.unit) },
    {
      title: t('batchPrices'),
      key: 'batchPrices',
      width: 350,
      render: (_, item) => <BatchPrices item={item} />,
    },
    {
      title: t('updated'),
      key: 'updated',
      width: 170,
      render: (_, item) => new Date(item.updatedAt).toLocaleString(),
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 150,
      render: (_, item) => <MaterialActions item={item} onRemove={remove} />,
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('count', { count: data.total })}</p>
        </div>
        <div className="material-heading-actions">
          <Link href="/admin/materials/batches">
            <Button>{t('manageBatches')}</Button>
          </Link>
          <Link href="/admin/materials/categories">
            <Button icon={<FolderOutlined />}>{t('manageCategories')}</Button>
          </Link>
          <Link href="/admin/materials/new">
            <Button type="primary" icon={<PlusOutlined />}>
              {t('new')}
            </Button>
          </Link>
        </div>
      </div>
      <div className="filter-bar">
        <Input
          className="filter-search"
          prefix={<SearchOutlined />}
          value={query}
          onChange={(event) => {
            setLoading(true);
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={t('search')}
          allowClear
        />
        <Cascader
          className="filter-select"
          options={categoryTree(categories)}
          value={categoryId ? categoryPath(categoryId, categories) : []}
          onChange={(path) => {
            setLoading(true);
            setCategoryId(path?.at(-1) as string | undefined);
            setPage(1);
          }}
          placeholder={t('category')}
          showSearch
          changeOnSelect
          allowClear
        />
      </div>
      <div className="table-surface">
        <div className="material-desktop-table">
          <Table
            rowKey="id"
            columns={columns}
            dataSource={data.items}
            loading={loading}
            scroll={{ x: 850 }}
            pagination={{
              ...CLIENT_TABLE_PAGINATION,
              current: page,
              pageSize,
              total: data.total,
              onChange: changePage,
            }}
            locale={{ emptyText: <Empty description={t('empty')} /> }}
          />
        </div>
        <div className="material-mobile-list">
          {loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : data.items.length ? (
            data.items.map((item) => (
              <article className="material-mobile-item" key={item.id}>
                <MaterialIdentity item={item} />
                <div className="material-mobile-meta">
                  {categoryPath(item.categoryId, categories)
                    .map(
                      (categoryId) =>
                        categories.find((category) => category.id === categoryId)?.name,
                    )
                    .join(' / ') || item.category.name}{' '}
                  · {t(item.unit)}
                </div>
                <div className="material-mobile-batches">
                  <span>{t('batchPrices')}</span>
                  <BatchPrices item={item} />
                </div>
                <div className="material-mobile-actions">
                  <MaterialActions item={item} onRemove={remove} />
                </div>
              </article>
            ))
          ) : (
            <Empty description={t('empty')} />
          )}
          {!loading && data.total > 0 && (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={data.total}
              showSizeChanger
              pageSizeOptions={CLIENT_TABLE_PAGINATION.pageSizeOptions}
              onChange={changePage}
            />
          )}
        </div>
      </div>
    </>
  );
}
