'use client';

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { App, Button, Empty, Input, Popconfirm, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useDeferredValue, useCallback } from 'react';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Category, Product, ProductPage } from '@/lib/client-types';

export function ProductsPage() {
  const t = useTranslations('products');
  const common = useTranslations('common');
  const locale = useLocale();
  const { message } = App.useApp();
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [categoryId, setCategoryId] = useState<string>();
  const [published, setPublished] = useState<string>();
  const [stock, setStock] = useState<string>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ProductPage>({ items: [], total: 0, page: 1, pageSize: 10 });
  const [loading, setLoading] = useState(true);

  const errorMessage = useCallback(
    (error: unknown) => {
      const code = error instanceof ClientApiError ? error.code : 'SERVER_ERROR';
      return common(`errors.${code}` as never);
    },
    [common],
  );

  useEffect(() => {
    apiFetch<Category[]>('/api/categories')
      .then(setCategories)
      .catch((error) => message.error(errorMessage(error)));
  }, [message, errorMessage]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: '10' });
    if (search) params.set('q', search);
    if (categoryId) params.set('categoryId', categoryId);
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
  }, [search, categoryId, published, stock, page, revision, message, errorMessage]);

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
            <Link className="product-name" href={`/admin/products/${item.id}`}>
              {item.name}
            </Link>
            <div className="product-code">{item.code}</div>
          </div>
        </div>
      ),
    },
    { title: t('category'), dataIndex: ['category', 'name'], key: 'category', width: 140 },
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
      title: t('inventory'),
      dataIndex: 'stock',
      key: 'stock',
      width: 120,
      render: (value: number) => (
        <Tag color={value ? 'success' : 'warning'}>{value ? t('inStock') : t('soldOut')}</Tag>
      ),
    },
    {
      title: t('publication'),
      dataIndex: 'published',
      key: 'published',
      width: 120,
      render: (value: boolean) => (
        <Tag color={value ? 'success' : 'default'}>{value ? t('published') : t('unpublished')}</Tag>
      ),
    },
    {
      title: t('updated'),
      dataIndex: 'updatedAt',
      key: 'updated',
      width: 150,
      render: (value: string) =>
        new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
          dateStyle: 'medium',
        }).format(new Date(value)),
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 100,
      render: (_, item) => (
        <span className="row-actions">
          <Link href={`/admin/products/${item.id}`}>
            <Button
              type="text"
              icon={<EditOutlined />}
              title={common('edit')}
              aria-label={common('edit')}
            />
          </Link>
          <Popconfirm
            title={t('deleteConfirm')}
            okText={common('delete')}
            cancelText={common('cancel')}
            onConfirm={() => remove(item.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              title={common('delete')}
              aria-label={common('delete')}
            />
          </Popconfirm>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('count', { count: data.total })}</p>
        </div>
        <Link href="/admin/products/new">
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
          options={categories.map((item) => ({ value: item.id, label: item.name }))}
        />
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
      </div>
      <div className="table-surface">
        <Table
          rowKey="id"
          dataSource={data.items}
          columns={columns}
          loading={loading}
          locale={{ emptyText: <Empty description={t('empty')} /> }}
          pagination={{
            current: page,
            pageSize: 10,
            total: data.total,
            showSizeChanger: false,
            onChange: (value) => {
              setLoading(true);
              setPage(value);
            },
          }}
        />
      </div>
    </>
  );
}
