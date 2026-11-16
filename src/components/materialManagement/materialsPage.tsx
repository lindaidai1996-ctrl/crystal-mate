'use client';

import { SearchFilterRow } from '@/components/responsive/searchFilterRow';
import { ResetFiltersButton } from '@/components/responsive/resetFiltersButton';

import { RecordAuditSummary, useRecordProvenance } from '@/components/audit-history';

import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  PlusOutlined,
  SearchOutlined,
  ScanOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Popconfirm,
  Popover,
  Segmented,
  Select,
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
import { useCategoryCounts } from '@/components/useCategoryCounts';
import { ImageHoverPreview } from './imageHoverPreview';
import { MaterialImportSources } from './materialImportSources';
import { MaterialBulkDialog } from './materialBulkDialog';
import { EditorDraftBox } from '@/components/editorDraftBox';
import { togglePageSelection } from '@/lib/material-bulk';
import bulkStyles from './materialBulkDialog.module.css';
import materialStyles from './materialsPage.module.css';
import { DateRangeFilter } from '@/components/date-range-filter';
import type { DateRange } from '@/lib/date-range';
import { useSessionListState } from '@/components/useSessionListState';
import { withAdminReturnTo } from '@/lib/admin-return-path';
import { CatalogGallery, CatalogGalleryImage } from '@/components/catalogGallery';
import { CatalogNote } from '@/components/catalogNote';
import catalogStyles from '@/components/productCatalog.module.css';
import { usePrivacyMode } from '@/components/privacyMode';
import { MaterialListFilters } from '@/components/responsive/materialListFilters';
import { ListPageActions } from '@/components/responsive/listPageActions';
import { MobileDetails } from '@/components/responsive/mobileDetails';

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

function BatchPrices({ item, card = false }: { item: Material; card?: boolean }) {
  const t = useTranslations('materialBatches');
  const privacyMode = usePrivacyMode();
  const editor = useTranslations('materialEditor');
  const entries = item.batchEntries;
  const unitSuffix = editor(
    item.unit === 'GRAM' ? 'yuanPerGram' : item.unit === 'STRAND' ? 'yuanPerStrand' : 'yuanPerBead',
  );
  const price = (value: string | null, suffix: string) =>
    value === null ? '—' : `${value} ${suffix}`;
  const priceRows = (
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
    const source =
      value.unitPriceSource === 'ESTIMATED' || value.unitPriceSource === 'MANUAL'
        ? t(`priceSource_${value.unitPriceSource}`)
        : undefined;
    return [
      [
        ...(!privacyMode
          ? [
              {
                label: t('purchaseUnitPrice'),
                value: item.unit === 'GRAM' ? value.purchaseGramPrice : value.purchaseUnitPrice,
                suffix: unitSuffix,
                source,
                sale: false,
              },
            ]
          : []),
        {
          label: t('salePrice'),
          value: item.unit === 'GRAM' ? value.saleGramPrice : value.saleUnitPrice,
          suffix: unitSuffix,
          sale: true,
        },
      ],
      ...(item.unit !== 'GRAM' &&
      (!card || (!privacyMode && value.purchaseGramPrice !== null) || value.saleGramPrice !== null)
        ? [
            [
              ...(!privacyMode
                ? [
                    {
                      label: t('gramPrice'),
                      value: value.purchaseGramPrice,
                      suffix: editor('yuanPerGram'),
                      sale: false,
                    },
                  ]
                : []),
              ...(value.saleGramPrice !== null
                ? [
                    {
                      label: t('saleGramPrice'),
                      value: value.saleGramPrice,
                      suffix: editor('yuanPerGram'),
                      sale: true,
                    },
                  ]
                : []),
            ],
          ]
        : []),
      ...(item.unit === 'STRAND'
        ? [
            [
              ...(!privacyMode && (value.childCount ?? 0) > 0 && value.childUnitPrice !== null
                ? [
                    {
                      label: t('purchaseBeadPrice'),
                      value: value.childUnitPrice,
                      suffix: editor('yuanPerBead'),
                      sale: false,
                    },
                  ]
                : []),
              ...(value.saleChildUnitPrice !== null
                ? [
                    {
                      label: t('saleBeadPrice'),
                      value: value.saleChildUnitPrice,
                      suffix: editor('yuanPerBead'),
                      sale: true,
                    },
                  ]
                : []),
            ],
          ]
        : []),
    ].filter((row) => row.length > 0);
  };
  const priceText = (value: Material | MaterialBatchEntry) =>
    priceRows(value)
      .flat()
      .map(
        (field) =>
          `${field.label}: ${price(field.value, field.suffix)}${'source' in field && field.source ? ` (${field.source})` : ''}`,
      )
      .join(' · ');
  const priceDetails = (value: Material | MaterialBatchEntry) =>
    card ? (
      <div className={materialStyles.priceGrid}>
        {priceRows(value).map((row) => (
          <dl className={materialStyles.priceRow} key={row[0].label}>
            {row.map((field) => (
              <div className={materialStyles.priceCell} data-sale={field.sale} key={field.label}>
                <dt>{field.label}</dt>
                <dd>
                  <strong>{field.value ?? '—'}</strong>
                  {field.value !== null && <span>{field.suffix}</span>}
                </dd>
                {'source' in field && field.source && <small>{field.source}</small>}
              </div>
            ))}
          </dl>
        ))}
      </div>
    ) : (
      <span className="material-price-summary">{priceText(value)}</span>
    );
  if (!entries.length)
    return (
      <div className={card ? materialStyles.batchGroup : 'material-price-summary'}>
        <span>{t('unassigned')}</span>
        {priceDetails(item)}
      </div>
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
      <div className={card ? materialStyles.batchGroup : 'material-batch-names'}>
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
        {priceDetails(entries[0])}
      </div>
    );
  return (
    <div className={card ? materialStyles.batchList : 'material-batch-prices'}>
      {entries.map((entry) => (
        <div className={card ? materialStyles.batchGroup : 'material-batch-price'} key={entry.id}>
          <Link
            href={withAdminReturnTo(
              `/admin/materials/batches/${entry.batchId}`,
              '/admin/materials',
            )}
          >
            {entry.batch.name}
          </Link>
          {priceDetails(entry)}
        </div>
      ))}
    </div>
  );
}

function materialImages(item: Material) {
  const seen = new Set<string>();
  return [...item.batchEntries.flatMap((entry) => entry.images), ...item.images].filter((image) => {
    if (seen.has(image.objectKey)) return false;
    seen.add(image.objectKey);
    return true;
  });
}

function MaterialIdentity({ item }: { item: Material }) {
  return (
    <div className="product-cell">
      <ImageHoverPreview images={materialImages(item)} name={item.name} />
      <div className={catalogStyles.identity}>
        <MaterialEditLink item={item} />
        <MaterialImportSources material={item} />
        {!!item.tags.length && (
          <div className="product-tags">
            {item.tags.map((tag) => (
              <TextTag key={tag.id} text={tag.name} />
            ))}
          </div>
        )}
        <CatalogNote text={item.notes} />
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
  const products = useTranslations('products');
  const bulk = useTranslations('materialBulk');
  const inventory = useTranslations('inventory');
  const common = useTranslations('common');
  const pagination = useTablePagination();
  const { message } = App.useApp();
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [view, setView] = useSessionListState<'table' | 'gallery'>('materials:view:v2', 'gallery');
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
  const countParams = new URLSearchParams();
  if (requestFilters.query) countParams.set('q', requestFilters.query);
  if (requestFilters.source) countParams.set('source', requestFilters.source);
  if (requestFilters.createdRange) {
    countParams.set('createdFrom', requestFilters.createdRange[0]);
    countParams.set('createdTo', requestFilters.createdRange[1]);
  }
  const filterQuery = countParams.toString();
  const categoryCounts = useCategoryCounts(
    `/api/materials/category-counts?${filterQuery}`,
    revision,
  );
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
    const { page, pageSize, categoryId } = requestFilters;
    const params = new URLSearchParams(filterQuery);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (categoryId) params.set('categoryId', categoryId);
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
  }, [requestFilters, filterQuery, revision, errorText, message]);

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
  const { records: provenance, failed: auditFailed } = useRecordProvenance('Material', data.items);
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
      render: (_, item) => (
        <>
          <div>{new Date(item.updatedAt).toLocaleString()}</div>
          <RecordAuditSummary
            entityType="Material"
            entityId={item.id}
            record={provenance[item.id]}
            failed={auditFailed}
          />
        </>
      ),
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 250,
      render: (_, item) => <MaterialActions item={item} onRemove={remove} onSaved={refreshStock} />,
    },
  ];

  const searchInput = (
    <SearchFilterRow>
      <Input
        className="filter-search"
        prefix={<SearchOutlined />}
        value={query}
        onChange={(event) => changeFilters({ query: event.target.value })}
        aria-label={t('search')}
        placeholder={t('search')}
        allowClear
      />
      <ResetFiltersButton
        onReset={() => {
          changeFilters({
            query: '',
            categoryId: undefined,
            source: undefined,
            createdRange: null,
          });
          setRevision((current) => current + 1);
        }}
      />
    </SearchFilterRow>
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('count', { count: data.total })}</p>
        </div>
        <ListPageActions
          primary={
            <Link href="/admin/materials/new">
              <Button type="primary" icon={<PlusOutlined />}>
                {t('new')}
              </Button>
            </Link>
          }
        >
          <EditorDraftBox kind="MATERIAL" returnTo="/admin/materials" />
          <Link href="/admin/materials/image-import">
            <Button icon={<ScanOutlined />}>{t('imageImport')}</Button>
          </Link>
          <Link href="/admin/materials/categories">
            <Button icon={<FolderOutlined />}>{t('manageCategories')}</Button>
          </Link>
        </ListPageActions>
      </div>
      <MaterialListFilters
        value={{ categoryId, source, createdRange }}
        categories={categories}
        onApply={changeFilters}
        search={searchInput}
      >
        <div className="filter-bar">
          {searchInput}
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
          counts={categoryCounts}
          onChange={(categoryId) => changeFilters({ categoryId })}
        />
      </MaterialListFilters>
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
        <Segmented
          className={bulkStyles.viewSwitch}
          aria-label={products('view')}
          value={view}
          options={[
            { value: 'gallery', label: products('galleryView'), icon: <AppstoreOutlined /> },
            { value: 'table', label: products('tableView'), icon: <UnorderedListOutlined /> },
          ]}
          onChange={setView}
        />
      </div>
      {view === 'gallery' ? (
        <CatalogGallery
          loading={loading}
          emptyDescription={t('empty')}
          pagination={{
            ...pagination,
            current: page,
            pageSize,
            total: data.total,
            onChange: changePage,
          }}
        >
          {data.items.map((item) => (
            <article key={item.id} className={catalogStyles.card}>
              {bulkMode && (
                <div className={catalogStyles.cardSelection}>
                  <Checkbox
                    checked={selectedIds.includes(item.id)}
                    disabled={loading}
                    onChange={(event) =>
                      setSelectedIds((ids) =>
                        togglePageSelection(ids, [item.id], event.target.checked),
                      )
                    }
                  >
                    {bulk('selectMaterial', { name: item.name })}
                  </Checkbox>
                </div>
              )}
              <CatalogGalleryImage
                images={materialImages(item)}
                name={item.name}
                soldOut={item.knownStock === 0 && item.unknownStockBatchCount === 0}
              />
              <div className={catalogStyles.cardBody}>
                <div className={catalogStyles.cardHeading}>
                  <MaterialEditLink item={item} />
                </div>
                <MaterialImportSources material={item} />
                <div className={catalogStyles.cardMeta}>
                  <span>
                    {categoryPath(item.categoryId, categories)
                      .map((id) => categories.find((category) => category.id === id)?.name)
                      .join(' / ') || item.category.name}
                  </span>
                  <span>{t(item.unit)}</span>
                </div>
                {!!item.tags.length && (
                  <div className={`product-tags ${catalogStyles.cardTags}`}>
                    {item.tags.map((tag) => (
                      <TextTag key={tag.id} text={tag.name} />
                    ))}
                  </div>
                )}
                <CatalogNote text={item.notes} />
                <MaterialStockSummary material={item} />
                <MobileDetails label={t('batchPrices')}>
                  <div className={catalogStyles.cardDetails}>
                    <BatchPrices item={item} card />
                  </div>
                </MobileDetails>
                <div className={catalogStyles.cardActions}>
                  <MaterialActions item={item} onRemove={remove} onSaved={refreshStock} />
                </div>
              </div>
            </article>
          ))}
        </CatalogGallery>
      ) : (
        <div className="table-surface">
          <PaginatedTable
            rowKey="id"
            mobileRender={(item) => (
              <>
                {bulkMode && (
                  <Checkbox
                    checked={selectedIds.includes(item.id)}
                    disabled={loading}
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
                <p className="mobile-record-meta">
                  {categoryPath(item.categoryId, categories)
                    .map((id) => categories.find((category) => category.id === id)?.name)
                    .join(' / ') || item.category.name}{' '}
                  · {t(item.unit)}
                </p>
                <MaterialStockSummary material={item} />
                <MobileDetails label={t('batchPrices')}>
                  <BatchPrices item={item} />
                  <p>
                    {t('updated')}: {new Date(item.updatedAt).toLocaleString()}
                  </p>
                </MobileDetails>
                <RecordAuditSummary
                  entityType="Material"
                  entityId={item.id}
                  record={provenance[item.id]}
                  failed={auditFailed}
                />
                <div className="mobile-record-actions">
                  <MaterialActions item={item} onRemove={remove} onSaved={refreshStock} />
                </div>
              </>
            )}
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
      )}
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
