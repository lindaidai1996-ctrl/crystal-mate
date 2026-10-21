'use client';

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  FileTextOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Result,
  Select,
  Skeleton,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useDeferredValue, useCallback } from 'react';
import { Link } from '@/i18n/navigation';
import { PaginatedTable } from '@/components/paginated-table';
import { StockAdjustmentDrawer } from '@/components/inventory/stockAdjustmentDrawer';
import { TextTag } from '@/components/text-tag';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Category, Product, ProductPage, Tag as CatalogTag } from '@/lib/client-types';
import { catalogPath, type CatalogScope } from '@/lib/catalog-scopes';
import { generateProductDetails } from '@/lib/generate-product-details';
import { CLIENT_TABLE_PAGINATION, DEFAULT_TABLE_PAGE_SIZE } from '@/lib/table-pagination';
import { MissingCategoryState } from './missing-category-state';
import { ImageHoverPreview } from './materialManagement/imageHoverPreview';

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

const cabochonMarketingFields = [
  { key: 'videoShot', width: 160 },
  { key: 'xiaohongshuVideoPublished', width: 210 },
  { key: 'xiaohongshuListed', width: 160 },
] as const;

type CabochonMarketingField = (typeof cabochonMarketingFields)[number]['key'];

export function ProductsPage({ scope }: { scope?: CatalogScope }) {
  const t = useTranslations('products');
  const inventory = useTranslations('inventory');
  const common = useTranslations('common');
  const catalog = useTranslations('catalog');
  const editor = useTranslations('editor');
  const marketingConfig = useTranslations('marketingConfig');
  const locale = useLocale();
  const { message } = App.useApp();
  const isCabochon = scope?.key === 'cabochons';
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryStatus, setCategoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [tags, setTags] = useState<CatalogTag[]>([]);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [categoryId, setCategoryId] = useState<string>();
  const [tagId, setTagId] = useState<string>();
  const [published, setPublished] = useState<string>();
  const [stock, setStock] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [revision, setRevision] = useState(0);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [data, setData] = useState<ProductPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
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
    if (!canLoadProducts) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('q', search);
    if (effectiveCategoryId) params.set('categoryId', effectiveCategoryId);
    if (scope?.key === 'finished-strands') params.set('excludeCategoryName', '蛋面');
    if (tagId) params.set('tagId', tagId);
    if (published) params.set('published', published);
    if (stock) params.set('stock', stock);
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
    published,
    stock,
    page,
    pageSize,
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

  async function copyProductInfo(measurement: Product['measurement']) {
    try {
      await navigator.clipboard.writeText(generateProductDetails(measurement));
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

  const columns: ColumnsType<Product> = [
    {
      title: t('name'),
      key: 'name',
      render: (_, item) => (
        <div className="product-cell">
          <ImageHoverPreview images={item.images} name={item.name} />
          <div>
            <Link className="product-name" href={`${listPath}/${item.id}`}>
              {item.name}
            </Link>
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
      width: 180,
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
            title: t('dimensions'),
            dataIndex: 'measurement',
            key: 'measurement',
            width: 230,
            render: (measurement: Product['measurement']) =>
              formatCabochonMeasurement(measurement, marketingConfig('missingDimension')),
          },
        ]
      : []),
    {
      title: t('price'),
      dataIndex: 'priceCents',
      key: 'price',
      width: 130,
      render: (value: number) =>
        new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
          style: 'currency',
          currency: 'CNY',
        }).format(value / 100),
    },
    {
      title: t('stockQuantity'),
      dataIndex: 'stock',
      key: 'stock',
      width: 120,
      render: (value: number) => value,
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
      ? cabochonMarketingFields.map(({ key, width }) => ({
          title: editor(key),
          key,
          width,
          render: (_: unknown, item: Product) => {
            const pendingKey = `${item.id}:${key}`;
            return (
              <Switch
                aria-label={`${item.name}：${editor(key)}`}
                checked={item.marketing?.[key] ?? false}
                loading={Boolean(pendingMarketing[pendingKey])}
                disabled={Boolean(pendingMarketing[pendingKey])}
                onChange={(checked) => void updateMarketing(item.id, key, checked)}
              />
            );
          },
        }))
      : []),
    {
      title: t('updated'),
      dataIndex: 'updatedAt',
      key: 'updated',
      width: isCabochon ? 180 : 150,
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
      width: scope?.key === 'cabochons' ? 500 : 200,
      render: (_, item) => (
        <span className="row-actions">
          <Button type="text" onClick={() => setStockProduct(item)}>
            {inventory('adjust')}
          </Button>
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
                onClick={() => void copyProductInfo(item.measurement)}
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
        <Link href={`${listPath}/new`}>
          <Button type="primary" icon={<PlusOutlined />}>
            {t('new')}
          </Button>
        </Link>
      </div>
      <div className="filter-bar">
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
        <Select
          className="filter-select"
          value={stock}
          onChange={(value) => {
            setLoading(true);
            setStock(value);
            setPage(1);
          }}
          placeholder={isCabochon ? t('stockFilter') : t('inventory')}
          allowClear
          options={[
            { value: '1', label: t('inStock') },
            { value: '0', label: t('soldOut') },
          ]}
        />
      </div>
      <div className="table-surface">
        <PaginatedTable
          rowKey="id"
          dataSource={data.items}
          columns={columns}
          loading={loading}
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
      {stockProduct && (
        <StockAdjustmentDrawer
          key={stockProduct.id}
          name={stockProduct.name}
          resourceUrl={`/api/products/${stockProduct.id}`}
          onClose={() => setStockProduct(null)}
          onSaved={() => {
            setLoading(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
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
