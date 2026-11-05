'use client';

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  ScanOutlined,
  FileTextOutlined,
  CopyOutlined,
  FileExcelOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Result,
  Segmented,
  Select,
  Space,
  Skeleton,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useDeferredValue, useCallback } from 'react';
import { Link } from '@/i18n/navigation';
import { PaginatedTable } from '@/components/paginated-table';
import { DateRangeFilter } from '@/components/date-range-filter';
import type { DateRange } from '@/lib/date-range';
import {
  CabochonMarketingStatus,
  type CabochonMarketingField,
} from '@/components/catalog/cabochonMarketingStatus';
import { TextTag } from '@/components/text-tag';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  Category,
  Product,
  ProductPage,
  SettingStyle,
  Tag as CatalogTag,
} from '@/lib/client-types';
import { catalogPath, type CatalogScope } from '@/lib/catalog-scopes';
import { generateProductDetails } from '@/lib/generate-product-details';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { MissingCategoryState } from './missing-category-state';
import { ImageHoverPreview } from './materialManagement/imageHoverPreview';
import { EditorDraftBox } from './editorDraftBox';
import { useSessionListState } from './useSessionListState';
import { withAdminReturnTo } from '@/lib/admin-return-path';
import { ProductInlineEdit, type ProductQuickEditChange } from './productInlineEdit';

type MarketingFilterValue = '' | 'true' | 'false';
type MarketingFilterField = CabochonMarketingField;
type MarketingFilters = Record<MarketingFilterField, MarketingFilterValue>;

const marketingFilterFields: MarketingFilterField[] = [
  'videoShot',
  'xiaohongshuVideoPublished',
  'xiaohongshuListed',
];
const emptyMarketingFilters: MarketingFilters = {
  videoShot: '',
  xiaohongshuVideoPublished: '',
  xiaohongshuListed: '',
};

const cabochonDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function ProductsPage({
  scope,
  initialSettingStyleId,
}: {
  scope?: CatalogScope;
  initialSettingStyleId?: string;
}) {
  const t = useTranslations('products');
  const diyImport = useTranslations('diyImport');
  const excelImport = useTranslations('cabochonExcel');
  const common = useTranslations('common');
  const catalog = useTranslations('catalog');
  const editor = useTranslations('editor');
  const marketingConfig = useTranslations('marketingConfig');
  const productSources = useTranslations('productSources');
  const locale = useLocale();
  const { message } = App.useApp();
  const isCabochon = scope?.key === 'cabochons';
  const isFinishedStrands = scope?.key === 'finished-strands';
  const cabochonActionWidth = locale === 'en' ? 360 : 320;
  const listStateKey = `products:${scope?.key ?? 'all'}`;
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryStatus, setCategoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [tags, setTags] = useState<CatalogTag[]>([]);
  const [settingStyles, setSettingStyles] = useState<SettingStyle[]>([]);
  const [query, setQuery] = useSessionListState(
    `${listStateKey}:query`,
    '',
    !initialSettingStyleId,
  );
  const search = useDeferredValue(query);
  const [categoryId, setCategoryId] = useSessionListState<string | undefined>(
    `${listStateKey}:categoryId`,
    undefined,
  );
  const [tagId, setTagId] = useSessionListState<string | undefined>(
    `${listStateKey}:tagId`,
    undefined,
    !initialSettingStyleId,
  );
  const [settingStyleId, setSettingStyleId] = useSessionListState<string | undefined>(
    `${listStateKey}:settingStyleId`,
    initialSettingStyleId,
    !initialSettingStyleId,
  );
  const [published, setPublished] = useSessionListState<string | undefined>(
    `${listStateKey}:published`,
    undefined,
  );
  const [origin, setOrigin] = useSessionListState<'all' | 'PURCHASED' | 'DIY'>(
    `${listStateKey}:origin`,
    'all',
  );
  const [stock, setStock] = useSessionListState<string | undefined>(
    `${listStateKey}:stock`,
    undefined,
    !initialSettingStyleId,
  );
  const [marketingFilters, setMarketingFilters] = useSessionListState<MarketingFilters>(
    `${listStateKey}:marketingFilters`,
    emptyMarketingFilters,
    !initialSettingStyleId,
  );
  const [createdRange, setCreatedRange] = useSessionListState<DateRange>(
    `${listStateKey}:createdRange`,
    null,
    !initialSettingStyleId,
  );
  const [page, setPage] = useSessionListState(`${listStateKey}:page`, 1, !initialSettingStyleId);
  const [pageSize, setPageSize] = useSessionListState(`${listStateKey}:pageSize`, 20);
  const [priceSort, setPriceSort] = useSessionListState<'ascend' | 'descend' | null>(
    `${listStateKey}:priceSort`,
    null,
    !initialSettingStyleId,
  );
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ProductPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [loading, setLoading] = useState(true);
  const [pendingMarketing, setPendingMarketing] = useState<Record<string, boolean>>({});
  const scopedCategory =
    scope?.key === 'cabochons'
      ? categories.find((item) => item.name === scope.categoryName)
      : undefined;
  const availableCategories =
    scope?.key === 'finished-strands'
      ? categories.filter((item) => item.name !== '蛋面')
      : categories;
  const hasScopedCategory =
    scope?.key === 'finished-strands' ? availableCategories.length > 0 : Boolean(scopedCategory);
  const effectiveCategoryId = isCabochon ? scopedCategory?.id : categoryId;
  const canLoadProducts = !scope || (categoryStatus === 'ready' && hasScopedCategory);
  const listPath = scope ? catalogPath(scope.key) : '/admin/products';

  const errorMessage = useCallback(
    (error: unknown) => {
      const code = error instanceof ClientApiError ? error.code : 'SERVER_ERROR';
      return common(`errors.${code}` as never);
    },
    [common],
  );

  useEffect(() => {
    let active = true;
    apiFetch<Category[]>('/api/categories')
      .then((items) => {
        if (!active) return;
        setCategories(items);
        setCategoryStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setCategoryStatus('error');
        if (!scope) message.error(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [message, errorMessage, scope, categoryRevision]);
  useEffect(() => {
    apiFetch<CatalogTag[]>('/api/tags')
      .then(setTags)
      .catch((error) => message.error(errorMessage(error)));
  }, [message, errorMessage]);
  useEffect(() => {
    if (!isCabochon) return;
    apiFetch<SettingStyle[]>('/api/setting-styles')
      .then(setSettingStyles)
      .catch((error) => message.error(errorMessage(error)));
  }, [isCabochon, message, errorMessage]);
  useEffect(() => {
    if (!canLoadProducts) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (priceSort) params.set('sortPrice', priceSort === 'ascend' ? 'asc' : 'desc');
    if (search) params.set('q', search);
    if (effectiveCategoryId) params.set('categoryId', effectiveCategoryId);
    if (scope?.key === 'finished-strands') params.set('excludeCategoryName', '蛋面');
    if (tagId) params.set('tagId', tagId);
    if (isCabochon && settingStyleId) params.set('settingStyleId', settingStyleId);
    if (published) params.set('published', published);
    if (isFinishedStrands && origin !== 'all') params.set('origin', origin);
    if (stock) params.set('stock', stock);
    if (isCabochon) {
      for (const field of marketingFilterFields) {
        if (marketingFilters[field]) params.set(field, marketingFilters[field]);
      }
    }
    if (createdRange) {
      params.set('createdFrom', createdRange[0]);
      params.set('createdTo', createdRange[1]);
    }
    apiFetch<ProductPage>(`/api/products?${params}`, { signal: controller.signal })
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted) message.error(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    search,
    effectiveCategoryId,
    canLoadProducts,
    scope,
    tagId,
    isCabochon,
    settingStyleId,
    published,
    origin,
    isFinishedStrands,
    stock,
    marketingFilters,
    createdRange,
    page,
    pageSize,
    priceSort,
    revision,
    message,
    errorMessage,
  ]);

  async function remove(id: string) {
    try {
      await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
      message.success(common('deleted'));
      setLoading(true);
      setRevision((value) => value + 1);
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  async function copyProductInfo(product: Product) {
    try {
      await navigator.clipboard.writeText(
        generateProductDetails(product.measurement, product.extraInfo?.settingStyle?.magicBoxStyle),
      );
      message.success(marketingConfig('copied'));
    } catch {
      message.error(marketingConfig('copyFailed'));
    }
  }

  async function updateMarketing(id: string, field: CabochonMarketingField, value: boolean) {
    const pendingKey = `${id}:${field}`;
    setPendingMarketing((current) => ({ ...current, [pendingKey]: true }));
    try {
      const saved = await apiFetch<{ value: boolean; updatedAt: string }>(
        `/api/products/${id}/marketing`,
        { method: 'PATCH', body: JSON.stringify({ field, value }) },
      );
      setData((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === id
            ? {
                ...item,
                marketing: { ...item.marketing, [field]: saved.value },
                updatedAt: item.updatedAt > saved.updatedAt ? item.updatedAt : saved.updatedAt,
              }
            : item,
        ),
      }));
      message.success(common('saved'));
      if (marketingFilters[field]) {
        setLoading(true);
        setRevision((current) => current + 1);
      }
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setPendingMarketing((current) => {
        const next = { ...current };
        delete next[pendingKey];
        return next;
      });
    }
  }

  async function saveQuickEdit(item: Product, change: ProductQuickEditChange) {
    try {
      if (change.field === 'stock') {
        await apiFetch(`/api/products/${item.id}/stock-adjustments`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: change.value,
            expectedQuantity: item.stock,
            reason: '',
          }),
        });
      } else {
        await apiFetch(`/api/products/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify(
            change.field === 'price'
              ? { field: 'price', priceCents: change.value }
              : { field: 'measurement', measurement: change.value },
          ),
        });
      }
      message.success(common('saved'));
      setLoading(true);
      setRevision((value) => value + 1);
    } catch (error) {
      message.error(errorMessage(error));
      if (error instanceof ClientApiError && error.code === 'STOCK_CHANGED') {
        setLoading(true);
        setRevision((value) => value + 1);
      }
      throw error;
    }
  }

  const columns: ColumnsType<Product> = [
    {
      title: t('name'),
      key: 'name',
      width: isCabochon ? 300 : undefined,
      fixed: isCabochon ? 'left' : undefined,
      render: (_, item) => (
        <div className="product-cell">
          <ImageHoverPreview images={item.images} name={item.name} />
          <div>
            <div className="product-name-line">
              <Link className="product-name" href={`${listPath}/${item.id}`}>
                {item.name}
              </Link>
              {isFinishedStrands && item.origin === 'DIY' && (
                <Tooltip title={productSources('DIY')}>
                  <span
                    className="product-diy-mark"
                    role="img"
                    aria-label={productSources('DIY')}
                    tabIndex={0}
                  >
                    {t('diy')}
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="product-code">{item.code}</div>
          </div>
        </div>
      ),
    },
    ...(!isCabochon
      ? [{ title: t('category'), dataIndex: ['category', 'name'], key: 'category', width: 140 }]
      : []),
    {
      title: t('tags'),
      key: 'tags',
      width: isCabochon ? 220 : 180,
      render: (_, item) => (
        <div className="product-tags">
          {item.tags.map((tag) => (
            <TextTag key={tag.id} text={tag.name} />
          ))}
        </div>
      ),
    },
    ...(isCabochon
      ? [
          {
            title: t('setting'),
            key: 'setting',
            width: 180,
            render: (_: unknown, item: Product) =>
              item.extraInfo?.settingStyle?.magicBoxStyle || editor('unknownSettingStyle'),
          },
          {
            title: t('dimensions'),
            dataIndex: 'measurement',
            key: 'measurement',
            width: 260,
            render: (_: Product['measurement'], item: Product) => (
              <ProductInlineEdit
                product={item}
                field="measurement"
                onSave={(change) => saveQuickEdit(item, change)}
              >
                {formatCabochonMeasurement(item.measurement, marketingConfig('missingDimension'))}
              </ProductInlineEdit>
            ),
          },
        ]
      : []),
    {
      title: t('price'),
      dataIndex: 'priceCents',
      key: 'price',
      sorter: true,
      sortOrder: priceSort,
      width: isCabochon ? 170 : 130,
      render: (value: number, item) => (
        <ProductInlineEdit
          product={item}
          field="price"
          onSave={(change) => saveQuickEdit(item, change)}
        >
          {new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
            style: 'currency',
            currency: 'CNY',
          }).format(value / 100)}
        </ProductInlineEdit>
      ),
    },
    {
      title: t('stockQuantity'),
      dataIndex: 'stock',
      key: 'stock',
      width: isCabochon ? 140 : 120,
      render: (value: number, item) => (
        <ProductInlineEdit
          product={item}
          field="stock"
          onSave={(change) => saveQuickEdit(item, change)}
        >
          {value}
        </ProductInlineEdit>
      ),
    },
    ...(!isCabochon
      ? [
          {
            title: t('publication'),
            dataIndex: 'published',
            key: 'published',
            width: 120,
            render: (value: boolean) => (
              <Tag color={value ? 'success' : 'default'}>
                {value ? t('published') : t('unpublished')}
              </Tag>
            ),
          },
        ]
      : []),
    ...(isCabochon
      ? [
          {
            title: editor('marketing'),
            key: 'marketing',
            width: 320,
            render: (_: unknown, item: Product) => (
              <CabochonMarketingStatus
                product={item}
                pending={pendingMarketing}
                onChange={updateMarketing}
              />
            ),
          },
        ]
      : []),
    {
      title: t('updated'),
      dataIndex: 'updatedAt',
      key: 'updated',
      width: isCabochon ? 210 : 150,
      render: (value: string) =>
        isCabochon
          ? formatCabochonUpdatedAt(value)
          : new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
              dateStyle: 'medium',
            }).format(new Date(value)),
    },
    {
      title: t('actions'),
      key: 'actions',
      width: isCabochon ? cabochonActionWidth : 100,
      render: (_, item) => (
        <span className={isCabochon ? 'row-actions cabochon-row-actions' : 'row-actions'}>
          {!isCabochon && (
            <Link href={`${listPath}/${item.id}`}>
              <Tooltip title={common('edit')}>
                <Button type="text" icon={<EditOutlined />} aria-label={common('edit')} />
              </Tooltip>
            </Link>
          )}
          {scope?.key === 'cabochons' && (
            <>
              <Link href={`${listPath}/${item.id}/marketing`}>
                <Tooltip title={t('marketingConfig')}>
                  <Button type="text" icon={<FileTextOutlined />} aria-label={t('marketingConfig')}>
                    {t('marketingConfig')}
                  </Button>
                </Tooltip>
              </Link>
              <Button
                type="text"
                icon={<CopyOutlined />}
                onClick={() => void copyProductInfo(item)}
              >
                {t('copyProductInfo')}
              </Button>
            </>
          )}
          <Popconfirm
            title={t('deleteConfirm')}
            okText={common('delete')}
            cancelText={common('cancel')}
            onConfirm={() => remove(item.id)}
          >
            <Tooltip title={common('delete')}>
              <Button type="text" danger icon={<DeleteOutlined />} aria-label={common('delete')} />
            </Tooltip>
          </Popconfirm>
        </span>
      ),
    },
  ];

  if (scope && categoryStatus === 'loading') return <Skeleton active paragraph={{ rows: 8 }} />;
  if (scope && categoryStatus === 'error')
    return (
      <Result
        status="error"
        title={catalog('categoryLoadFailed')}
        extra={
          <Button
            onClick={() => {
              setCategoryStatus('loading');
              setCategoryRevision((value) => value + 1);
            }}
          >
            {common('retry')}
          </Button>
        }
      />
    );
  if (scope && !hasScopedCategory)
    return (
      <MissingCategoryState
        categoryName={scope.key === 'cabochons' ? scope.categoryName : undefined}
        pageTitle={common(scope.titleKey)}
      />
    );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{scope ? common(scope.titleKey) : t('title')}</h1>
          <p>{t('count', { count: data.total })}</p>
        </div>
        <Space wrap>
          <EditorDraftBox kind="PRODUCT" returnTo={listPath} />
          {isCabochon && (
            <Link href={`${listPath}/excel-import`}>
              <Button icon={<FileExcelOutlined />}>{excelImport('entry')}</Button>
            </Link>
          )}
          {!isCabochon && (
            <Link href={withAdminReturnTo('/admin/products/diy-image-import', listPath)}>
              <Button icon={<ScanOutlined />}>{diyImport('entry')}</Button>
            </Link>
          )}
          <Link href={`${listPath}/new`}>
            <Button type="primary" icon={<PlusOutlined />}>
              {t('new')}
            </Button>
          </Link>
        </Space>
      </div>
      <div className={isFinishedStrands ? 'filter-bar filter-bar--finished' : 'filter-bar'}>
        <div className="product-filter-primary">
          <Input
            className="filter-search"
            value={query}
            onChange={(event) => {
              setLoading(true);
              setQuery(event.target.value);
              setPage(1);
            }}
            prefix={<SearchOutlined />}
            placeholder={t('search')}
            allowClear
          />
          {isFinishedStrands && (
            <div className="product-origin-filter">
              <span className="product-origin-label">{t('originFilter')}</span>
              <Segmented<'all' | 'PURCHASED' | 'DIY'>
                size="small"
                aria-label={t('originFilter')}
                value={origin}
                options={[
                  { value: 'all', label: t('all') },
                  { value: 'PURCHASED', label: t('purchased') },
                  { value: 'DIY', label: t('diy') },
                ]}
                onChange={(value) => {
                  setLoading(true);
                  setOrigin(value);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
        {!isCabochon && (
          <Select
            className="filter-select"
            value={categoryId}
            onChange={(value) => {
              setLoading(true);
              setCategoryId(value);
              setPage(1);
            }}
            placeholder={t('category')}
            allowClear
            options={availableCategories.map((item) => ({ value: item.id, label: item.name }))}
          />
        )}
        {isCabochon && (
          <Select
            className="filter-select"
            value={settingStyleId}
            onChange={(value) => {
              setLoading(true);
              setSettingStyleId(value);
              setPage(1);
            }}
            placeholder={t('setting')}
            aria-label={t('setting')}
            allowClear
            showSearch
            optionFilterProp="label"
            options={[
              ...settingStyles.map((item) => ({ value: item.id, label: item.magicBoxStyle })),
              { value: 'unset', label: t('unsetSetting') },
            ]}
          />
        )}
        <Select
          className="filter-select"
          value={tagId}
          onChange={(value) => {
            setLoading(true);
            setTagId(value);
            setPage(1);
          }}
          placeholder={t('tags')}
          allowClear
          showSearch
          optionFilterProp="label"
          options={tags.map((item) => ({ value: item.id, label: item.name }))}
        />
        {!isCabochon && (
          <Select
            className="filter-select"
            value={published}
            onChange={(value) => {
              setLoading(true);
              setPublished(value);
              setPage(1);
            }}
            placeholder={t('publication')}
            allowClear
            options={[
              { value: 'true', label: t('published') },
              { value: 'false', label: t('unpublished') },
            ]}
          />
        )}
        {!isCabochon && (
          <Select
            className="filter-select"
            value={stock}
            onChange={(value) => {
              setLoading(true);
              setStock(value);
              setPage(1);
            }}
            placeholder={t('inventory')}
            allowClear
            options={[
              { value: '1', label: t('inStock') },
              { value: '0', label: t('soldOut') },
            ]}
          />
        )}
        <DateRangeFilter
          kind="created"
          value={createdRange}
          onChange={(range) => {
            setLoading(true);
            setCreatedRange(range);
            setPage(1);
          }}
        />
      </div>
      {isCabochon && (
        <div className="cabochon-filter-row">
          <div className="cabochon-filter-group">
            <span className="cabochon-filter-label">{t('stockFilter')}</span>
            <Segmented
              aria-label={t('stockFilter')}
              value={stock ?? ''}
              options={[
                { value: '', label: t('all') },
                { value: '1', label: t('inStock') },
                { value: '0', label: t('soldOut') },
              ]}
              onChange={(value) => {
                setLoading(true);
                setStock(value || undefined);
                setPage(1);
              }}
            />
          </div>
          {marketingFilterFields.map((field) => (
            <div className="cabochon-filter-group" key={field}>
              <span className="cabochon-filter-label">{editor(field)}</span>
              <Segmented<MarketingFilterValue>
                aria-label={editor(field)}
                value={marketingFilters[field]}
                options={[
                  { value: '', label: t('all') },
                  { value: 'true', label: t('completed') },
                  { value: 'false', label: t('incomplete') },
                ]}
                onChange={(value) => {
                  setLoading(true);
                  setMarketingFilters((current) => ({ ...current, [field]: value }));
                  setPage(1);
                }}
              />
            </div>
          ))}
        </div>
      )}
      <div className="table-surface">
        <PaginatedTable
          rowKey="id"
          dataSource={data.items}
          columns={columns}
          scroll={isCabochon ? { x: 1800 + cabochonActionWidth } : undefined}
          loading={loading}
          onChange={(_, __, sorter, extra) => {
            if (extra.action !== 'sort') return;
            const order = Array.isArray(sorter) ? sorter[0]?.order : sorter.order;
            setPriceSort(order === 'ascend' || order === 'descend' ? order : null);
            setPage(1);
            setLoading(true);
          }}
          locale={{ emptyText: <Empty description={t('empty')} /> }}
          pagination={{
            ...CLIENT_TABLE_PAGINATION,
            current: page,
            pageSize,
            total: data.total,
            onChange: (nextPage, nextPageSize) => {
              setLoading(true);
              setPage(nextPageSize === pageSize ? nextPage : 1);
              setPageSize(nextPageSize);
            },
          }}
        />
      </div>
    </>
  );
}

function formatCabochonMeasurement(measurement: Product['measurement'], missing: string) {
  if (!measurement) return missing;
  return `${[measurement.lengthMm, measurement.widthMm, measurement.heightMm]
    .map((value) => value ?? missing)
    .join(' × ')} mm`;
}

function formatCabochonUpdatedAt(value: string) {
  const parts = Object.fromEntries(
    cabochonDateTimeFormatter
      .formatToParts(new Date(value))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
