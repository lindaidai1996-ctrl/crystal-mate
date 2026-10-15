'use client';

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  PictureOutlined,
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
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useDeferredValue, useCallback } from 'react';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Category, Product, ProductPage, Tag as CatalogTag } from '@/lib/client-types';
import { catalogPath, type CatalogScope } from '@/lib/catalog-scopes';
import { generateProductDetails } from '@/lib/generate-product-details';
import { CLIENT_TABLE_PAGINATION, DEFAULT_TABLE_PAGE_SIZE } from '@/lib/table-pagination';
import { MissingCategoryState } from './missing-category-state';

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

const productTagColors = [
  'magenta',
  'red',
  'volcano',
  'orange',
  'gold',
  'lime',
  'green',
  'cyan',
  'blue',
  'geekblue',
  'purple',
] as const;

const productTagColorRules = [
  {
    keywords: ['玫红', '桃红', '洋红', '品红', '粉色', '粉', 'magenta', 'fuchsia', 'pink'],
    color: 'magenta',
  },
  { keywords: ['火山', '朱红', '橘红', '珊瑚', 'coral', 'vermilion', 'volcano'], color: 'volcano' },
  { keywords: ['红色', '红', 'red', 'scarlet', 'crimson'], color: 'red' },
  { keywords: ['橙色', '橙', '橘', '桔', 'orange', 'tangerine'], color: 'orange' },
  { keywords: ['金色', '金', '黄色', '黄', 'gold', 'golden', 'amber', 'yellow'], color: 'gold' },
  { keywords: ['青柠', '酸橙', 'lime', 'chartreuse'], color: 'lime' },
  { keywords: ['绿色', '绿', 'green', 'emerald', 'jade', 'olive'], color: 'green' },
  { keywords: ['青色', '青', 'cyan', 'turquoise', 'teal', 'aqua'], color: 'cyan' },
  { keywords: ['靛蓝', '靛', 'indigo', 'geekblue'], color: 'geekblue' },
  { keywords: ['蓝色', '蓝', 'blue', 'azure', 'navy', 'sapphire'], color: 'blue' },
  { keywords: ['紫色', '紫', 'purple', 'violet', 'lavender'], color: 'purple' },
  { keywords: ['棕色', '棕', '褐', '咖啡', 'brown', 'beige'], color: '#8b5e3c' },
  { keywords: ['黑色', '黑', 'black'], color: '#262626' },
  { keywords: ['白色', '白', 'white'], color: '#f5f5f5' },
  { keywords: ['银色', '银', 'silver'], color: '#d9d9d9' },
  { keywords: ['灰色', '灰', 'gray', 'grey'], color: '#595959' },
] as const;

type CabochonMarketingField = (typeof cabochonMarketingFields)[number]['key'];

export function ProductsPage({ scope }: { scope?: CatalogScope }) {
  const t = useTranslations('products');
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
          {item.images[0] ? (
            <Image
              unoptimized
              width={44}
              height={44}
              className="product-thumb"
              src={item.images[0].url}
              alt=""
            />
          ) : (
            <span className="product-thumb product-thumb-empty">
              <PictureOutlined />
            </span>
          )}
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
            <Tag key={tag.id} {...getProductTagProps(tag.name)}>
              {tag.name}
            </Tag>
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
      title: isCabochon ? t('stockQuantity') : t('inventory'),
      dataIndex: 'stock',
      key: 'stock',
      width: 120,
      render: (value: number) =>
        isCabochon ? (
          value
        ) : (
          <Tag color={value ? 'success' : 'warning'}>{value ? t('inStock') : t('soldOut')}</Tag>
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
      width: scope?.key === 'cabochons' ? 400 : 100,
      render: (_, item) => (
        <span className="row-actions">
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
        <Table
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

function getProductTagProps(name: string) {
  const normalizedName = name.trim().toLowerCase();
  // Prefer specific color phrases, then the first color mentioned in the name.
  const matches = productTagColorRules.flatMap(({ keywords, color }) =>
    keywords.flatMap((keyword) => {
      const index = /^[a-z]+$/.test(keyword)
        ? normalizedName.search(new RegExp(`\\b${keyword}\\b`, 'u'))
        : normalizedName.indexOf(keyword);
      return index < 0 ? [] : [{ color, index, length: keyword.length }];
    }),
  );
  matches.sort((a, b) => b.length - a.length || a.index - b.index);
  const color = matches[0]?.color ?? getFallbackProductTagColor(normalizedName);
  if (color === '#f5f5f5' || color === '#d9d9d9') {
    return { color, style: { color: '#595959', borderColor: '#d9d9d9' } };
  }
  return { color: color.startsWith('#') ? color : `${color}-inverse` };
}

function getFallbackProductTagColor(name: string) {
  const hash = [...name].reduce(
    (total, character) => (Math.imul(total, 31) + character.charCodeAt(0)) >>> 0,
    0,
  );
  return productTagColors[hash % productTagColors.length];
}
