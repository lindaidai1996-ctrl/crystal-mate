'use client';

import {
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  PlusOutlined,
  SearchOutlined,
  ScanOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Pagination,
  Popconfirm,
  Popover,
  Select,
  Skeleton,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useDeferredValue, useEffect, useState, type ReactElement } from 'react';
import { Link } from '@/i18n/navigation';
import { PaginatedTable, useTablePagination } from '@/components/paginated-table';
import { TextTag } from '@/components/text-tag';
import { MaterialStockButton } from '@/components/inventory/materialStockButton';
import { MaterialStockSummary } from '@/components/inventory/materialStockSummary';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  MaterialBatchEntry,
  Material,
  MaterialCategory,
  MaterialPage,
} from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { categoryPath } from './categoryTree';
import { MaterialCategoryFilter } from './materialCategoryFilter';
import { ImageHoverPreview } from './imageHoverPreview';
import { MaterialImportSources } from './materialImportSources';
import { MaterialBulkDialog } from './materialBulkDialog';
import { EditorDraftBox } from '@/components/editorDraftBox';
import { togglePageSelection } from '@/lib/material-bulk';
import bulkStyles from './materialBulkDialog.module.css';
import { DateRangeFilter } from '@/components/date-range-filter';
import type { DateRange } from '@/lib/date-range';
import { useSessionListState } from '@/components/useSessionListState';
import { withAdminReturnTo } from '@/lib/admin-return-path';

const MATERIAL_PAGE_SIZE = 20;
type MaterialFilters = {
  query: string;
  categoryId?: string;
  source?: 'IMAGE_IMPORT' | 'OTHER';
  createdRange: DateRange;
  page: number;
  pageSize: number;
};

function initialFilters(query = ''): MaterialFilters {
  return { query, createdRange: null, page: 1, pageSize: MATERIAL_PAGE_SIZE };
}

function BatchPrices({ item }: { item: Material }) {
  const t = useTranslations('materialBatches');
  const editor = useTranslations('materialEditor');
  const entries = item.batchEntries;
  const unitSuffix = editor(
    item.unit === 'GRAM' ? 'yuanPerGram' : item.unit === 'STRAND' ? 'yuanPerStrand' : 'yuanPerBead',
  );
  const price = (value: string | null, suffix: string) =>
    value === null ? '—' : `${value} ${suffix}`;
  const priceText = (
    value: Pick<
      Material,
      | 'purchaseUnitPrice'
      | 'purchaseGramPrice'
      | 'saleUnitPrice'
      | 'saleGramPrice'
      | 'saleChildUnitPrice'
      | 'childCount'
      | 'childUnitPrice'
    > &
      Partial<Pick<MaterialBatchEntry, 'unitPriceSource'>>,
  ) => {
    const sourceLabel =
      value.unitPriceSource === 'ESTIMATED' || value.unitPriceSource === 'MANUAL'
        ? ` (${t(`priceSource_${value.unitPriceSource}`)})`
        : '';
    return [
      ...(item.unit === 'GRAM'
        ? []
        : [
            `${t('purchaseUnitPrice')}: ${price(value.purchaseUnitPrice, unitSuffix)}${sourceLabel}`,
          ]),
      `${t('gramPrice')}: ${price(value.purchaseGramPrice, editor('yuanPerGram'))}`,
      `${t('salePrice')}: ${price(item.unit === 'GRAM' ? value.saleGramPrice : value.saleUnitPrice, unitSuffix)}`,
      ...(item.unit !== 'GRAM' && value.saleGramPrice !== null
        ? [`${t('saleGramPrice')}: ${price(value.saleGramPrice, editor('yuanPerGram'))}`]
        : []),
      ...(item.unit === 'STRAND' && (value.childCount ?? 0) > 0 && value.childUnitPrice !== null
        ? [`${t('purchaseBeadPrice')}: ${value.childUnitPrice} ${editor('yuanPerBead')}`]
        : []),
      ...(item.unit === 'STRAND' && value.saleChildUnitPrice !== null
        ? [`${t('saleBeadPrice')}: ${value.saleChildUnitPrice} ${editor('yuanPerBead')}`]
        : []),
    ].join(' · ');
  };
  if (!entries.length)
    return (
      <span className="material-price-summary">
        {t('unassigned')} · {priceText(item)}
      </span>
    );
  const samePrice = entries.every(
    (entry) =>
      entry.unitPriceSource === entries[0].unitPriceSource &&
      priceText(entry) === priceText(entries[0]),
  );
  const links = entries.map((entry) => (
    <Link
      key={entry.id}
      href={withAdminReturnTo(`/admin/materials/batches/${entry.batchId}`, '/admin/materials')}
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
          <Link
            href={withAdminReturnTo(
              `/admin/materials/batches/${entry.batchId}`,
              '/admin/materials',
            )}
          >
            {entry.batch.name}
          </Link>
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
      <div>
        <MaterialEditLink item={item} />
        <MaterialImportSources material={item} />
        {!!item.tags.length && (
          <div className="product-tags">
            {item.tags.map((tag) => (
              <TextTag key={tag.id} text={tag.name} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialEditLink({ item, children }: { item: Material; children?: ReactElement }) {
  const t = useTranslations('materials');
  if (item.batchEntries.length > 1)
    return (
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
        {children ?? (
          <button type="button" className="product-name material-edit-name">
            {item.name}
          </button>
        )}
      </Popover>
    );
  return (
    <Link
      className={children ? undefined : 'product-name'}
      href={`/admin/materials/${item.id}/batches/${item.batchEntries[0]?.id ?? 'new'}`}
    >
      {children ?? item.name}
    </Link>
  );
}

function MaterialActions({
  item,
  onRemove,
  onSaved,
}: {
  item: Material;
  onRemove: (id: string) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('materials');
  const common = useTranslations('common');
  const editButton = (
    <Tooltip title={common('edit')}>
      <Button type="text" icon={<EditOutlined />} aria-label={`${common('edit')} ${item.name}`} />
    </Tooltip>
  );
  return (
    <span className="row-actions">
      <MaterialStockButton
        allowDecimals={item.unit === 'GRAM'}
        materialId={item.id}
        name={item.name}
        unit={t(item.unit)}
        entries={item.batchEntries}
        onSaved={onSaved}
      />
      <MaterialEditLink item={item}>{editButton}</MaterialEditLink>
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
  const bulk = useTranslations('materialBulk');
  const inventory = useTranslations('inventory');
  const common = useTranslations('common');
  const pagination = useTablePagination();
  const { message } = App.useApp();
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [filters, setFilters] = useSessionListState(
    'materials:filters',
    initialFilters(initialQuery),
    !initialQuery,
  );
  const { query, categoryId, source, createdRange, page, pageSize } = filters;
  const requestFilters = useDeferredValue(filters);

  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<{ intent: 'edit' | 'delete'; ids: string[] }>();
  const [data, setData] = useState<MaterialPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: MATERIAL_PAGE_SIZE,
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
    const { query: search, page, pageSize, categoryId, source, createdRange } = requestFilters;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('q', search);
    if (categoryId) params.set('categoryId', categoryId);
    if (source) params.set('source', source);
    if (createdRange) {
      params.set('createdFrom', createdRange[0]);
      params.set('createdTo', createdRange[1]);
    }
    apiFetch<MaterialPage>(`/api/materials?${params}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) message.error(errorText(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestFilters, revision, errorText, message]);

  function updateFilters(patch: Partial<MaterialFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function changeFilters(patch: Partial<MaterialFilters>) {
    setSelectedIds([]);
    setLoading(true);
    updateFilters({ ...patch, page: 1 });
  }

  function changePage(nextPage: number, nextPageSize: number) {
    setLoading(true);
    updateFilters({ page: nextPageSize === pageSize ? nextPage : 1, pageSize: nextPageSize });
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/materials/${id}`, { method: 'DELETE' });
      setSelectedIds((ids) => ids.filter((selectedId) => selectedId !== id));
      message.success(common('deleted'));
      setLoading(true);
      updateFilters({ page: 1 });
      setRevision((value) => value + 1);
    } catch (error) {
      message.error(errorText(error));
    }
  }

  const refreshStock = () => {
    setRevision((value) => value + 1);
  };
  const columns: ColumnsType<Material> = [
    {
      title: t('name'),
      key: 'name',
      width: 260,
      minWidth: 260,
      render: (_, item) => <MaterialIdentity item={item} />,
    },
    {
      title: t('category'),
      key: 'category',
      width: 180,
      minWidth: 180,
      render: (_, item) =>
        categoryPath(item.categoryId, categories)
          .map((id) => categories.find((category) => category.id === id)?.name)
          .join(' / ') || item.category.name,
    },
    { title: t('unit'), key: 'unit', width: 90, render: (_, item) => t(item.unit) },
    {
      title: inventory('current'),
      key: 'stock',
      width: 110,
      render: (_, item) => <MaterialStockSummary material={item} />,
    },
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
      width: 250,
      render: (_, item) => <MaterialActions item={item} onRemove={remove} onSaved={refreshStock} />,
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
          <EditorDraftBox kind="MATERIAL" returnTo="/admin/materials" />
          <Link href="/admin/materials/image-import">
            <Button icon={<ScanOutlined />}>{t('imageImport')}</Button>
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
          onChange={(event) => changeFilters({ query: event.target.value })}
          placeholder={t('search')}
          allowClear
        />
        <Select
          className="filter-select"
          aria-label={t('source')}
          placeholder={t('allSources')}
          value={source}
          allowClear
          options={[
            { value: 'IMAGE_IMPORT', label: t('sourceImageImport') },
            { value: 'OTHER', label: t('sourceOther') },
          ]}
          onChange={(value) => changeFilters({ source: value })}
        />
        <DateRangeFilter
          kind="created"
          value={createdRange}
          onChange={(range) => changeFilters({ createdRange: range })}
        />
      </div>
      <MaterialCategoryFilter
        categories={categories}
        value={categoryId}
        onChange={(categoryId) => changeFilters({ categoryId })}
      />
      <div className={bulkStyles.toolbar}>
        <Button
          onClick={() => {
            setBulkMode((value) => !value);
            setSelectedIds([]);
          }}
        >
          {bulkMode ? bulk('cancel') : bulk('start')}
        </Button>
        {bulkMode && (
          <>
            <span aria-live="polite">{bulk('selected', { count: selectedIds.length })}</span>
            <Button
              disabled={loading || !data.items.length}
              onClick={() =>
                setSelectedIds((ids) =>
                  togglePageSelection(
                    ids,
                    data.items.map((item) => item.id),
                    true,
                  ),
                )
              }
            >
              {bulk('selectPage')}
            </Button>
            <Button
              disabled={loading || !data.items.some((item) => selectedIds.includes(item.id))}
              onClick={() =>
                setSelectedIds((ids) =>
                  togglePageSelection(
                    ids,
                    data.items.map((item) => item.id),
                    false,
                  ),
                )
              }
            >
              {bulk('deselectPage')}
            </Button>
            <Button disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>
              {bulk('clear')}
            </Button>
            <Button
              icon={<EditOutlined />}
              disabled={!selectedIds.length}
              onClick={() => setBulkAction({ intent: 'edit', ids: [...selectedIds] })}
            >
              {common('edit')}
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!selectedIds.length}
              onClick={() => setBulkAction({ intent: 'delete', ids: [...selectedIds] })}
            >
              {common('delete')}
            </Button>
          </>
        )}
      </div>
      <div className="table-surface">
        <div className="material-desktop-table">
          <PaginatedTable
            rowKey="id"
            rowSelection={
              bulkMode
                ? {
                    selectedRowKeys: selectedIds,
                    preserveSelectedRowKeys: true,
                    onChange: (keys) => setSelectedIds(keys.map(String)),
                    getCheckboxProps: () => ({ disabled: loading }),
                  }
                : undefined
            }
            columns={columns}
            dataSource={data.items}
            loading={loading}
            scroll={{ x: bulkMode ? 1458 : 1410 }}
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
                {bulkMode && (
                  <Checkbox
                    checked={selectedIds.includes(item.id)}
                    onChange={(event) =>
                      setSelectedIds((ids) =>
                        togglePageSelection(ids, [item.id], event.target.checked),
                      )
                    }
                  >
                    {bulk('selectMaterial', { name: item.name })}
                  </Checkbox>
                )}
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
                <div className="material-mobile-meta">
                  <MaterialStockSummary material={item} />
                </div>
                <div className="material-mobile-batches">
                  <span>{t('batchPrices')}</span>
                  <BatchPrices item={item} />
                </div>
                <div className="material-mobile-actions">
                  <MaterialActions item={item} onRemove={remove} onSaved={refreshStock} />
                </div>
              </article>
            ))
          ) : (
            <Empty description={t('empty')} />
          )}
          {!loading && (
            <Pagination
              {...pagination}
              current={page}
              pageSize={pageSize}
              total={data.total}
              onChange={changePage}
            />
          )}
        </div>
      </div>
      {bulkAction && (
        <MaterialBulkDialog
          intent={bulkAction.intent}
          materialIds={bulkAction.ids}
          categories={categories}
          onClose={() => setBulkAction(undefined)}
          onSaved={() => {
            message.success(bulkAction.intent === 'delete' ? common('deleted') : common('saved'));
            if (bulkAction.intent === 'delete') {
              setSelectedIds([]);
              updateFilters({ page: 1 });
            }
            setBulkAction(undefined);
            setLoading(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
