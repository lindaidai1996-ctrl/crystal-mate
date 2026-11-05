'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Empty, Input, Popconfirm, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { PaginatedTable } from '@/components/paginated-table';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialBatch } from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { BatchEditorDrawer } from './batchEditorDrawer';
import { coverFirstAttachments } from '@/lib/attachments';
import { ImageHoverPreview } from './imageHoverPreview';
import { DateRangeFilter } from '@/components/date-range-filter';
import { inDateRange, type DateRange } from '@/lib/date-range';
import { useSessionListState } from '@/components/useSessionListState';

type BatchSort = {
  key: 'date' | 'entries' | 'productEntries';
  order: 'ascend' | 'descend';
};

export function MaterialBatchesPage() {
  const t = useTranslations('materialBatches');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [items, setItems] = useState<MaterialBatch[]>([]);
  const [query, setQuery] = useSessionListState('material-batches:query', '');
  const [receivedRange, setReceivedRange] = useSessionListState<DateRange>(
    'material-batches:receivedRange',
    null,
  );
  const [page, setPage] = useSessionListState('material-batches:page', 1);
  const [pageSize, setPageSize] = useSessionListState('material-batches:pageSize', 20);
  const [sort, setSort] = useSessionListState<BatchSort | null>('material-batches:sort', {
    key: 'date',
    order: 'descend',
  });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MaterialBatch | null | undefined>(undefined);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        (!term || item.name.toLocaleLowerCase().includes(term)) &&
        inDateRange(item.receivedAt, receivedRange),
    );
  }, [items, query, receivedRange]);

  function showError(error: unknown) {
    message.error(
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    );
  }

  useEffect(() => {
    apiFetch<MaterialBatch[]>('/api/material-batches')
      .then(setItems)
      .catch(showError)
      .finally(() => setLoading(false));
    // The list is loaded once; mutations update it locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(id: string) {
    try {
      await apiFetch(`/api/material-batches/${id}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.id !== id));
      setPage((current) =>
        Math.min(current, Math.max(1, Math.ceil((visible.length - 1) / pageSize))),
      );
      message.success(common('deleted'));
    } catch (error) {
      showError(error);
    }
  }

  const columns: ColumnsType<MaterialBatch> = [
    {
      title: t('name'),
      key: 'name',
      render: (_, item) => (
        <div className="product-cell">
          <ImageHoverPreview
            key={item.coverObjectKey ?? item.attachments?.[0]?.objectKey ?? item.id}
            images={coverFirstAttachments(item.attachments ?? [], item.coverObjectKey)}
            coverObjectKey={item.coverObjectKey ?? null}
            name={item.name}
          />
          <Link className="product-name" href={`/admin/materials/batches/${item.id}`}>
            {item.name}
          </Link>
        </div>
      ),
    },
    {
      title: t('date'),
      key: 'date',
      width: 150,
      sorter: (a, b) => a.receivedAt.localeCompare(b.receivedAt),
      sortOrder: sort?.key === 'date' ? sort.order : null,
      render: (_, item) => item.receivedAt.slice(0, 10),
    },
    {
      title: t('materialCount'),
      key: 'entries',
      width: 130,
      sorter: (a, b) => (a._count?.entries ?? 0) - (b._count?.entries ?? 0),
      sortOrder: sort?.key === 'entries' ? sort.order : null,
      render: (_, item) => item._count?.entries ?? 0,
    },
    {
      title: t('productCount'),
      key: 'productEntries',
      width: 130,
      sorter: (a, b) => (a._count?.productEntries ?? 0) - (b._count?.productEntries ?? 0),
      sortOrder: sort?.key === 'productEntries' ? sort.order : null,
      render: (_, item) => item._count?.productEntries ?? 0,
    },
    {
      title: t('attachmentCount'),
      key: 'attachments',
      width: 130,
      render: (_, item) => item._count?.attachments ?? item.attachments?.length ?? 0,
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 110,
      render: (_, item) => (
        <span className="row-actions">
          <Tooltip title={common('edit')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              aria-label={`${common('edit')} ${item.name}`}
              onClick={() => setEditing(item)}
            />
          </Tooltip>
          <Popconfirm
            title={t('deleteBatch')}
            okText={common('delete')}
            cancelText={common('cancel')}
            onConfirm={() => remove(item.id)}
          >
            <Tooltip title={common('delete')}>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={`${common('delete')} ${item.name}`}
              />
            </Tooltip>
          </Popconfirm>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('manage')}</h1>
          <p>{t('count', { count: items.length })}</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={loading}
          onClick={() => setEditing(null)}
        >
          {t('newBatch')}
        </Button>
      </div>
      <div className="filter-bar">
        <Input.Search
          className="filter-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={t('search')}
          aria-label={t('search')}
          allowClear
        />
        <DateRangeFilter
          kind="received"
          value={receivedRange}
          onChange={(range) => {
            setReceivedRange(range);
            setPage(1);
          }}
        />
      </div>
      <div className="table-surface">
        <PaginatedTable
          rowKey="id"
          columns={columns}
          dataSource={visible}
          loading={loading}
          onChange={(_, __, sorter, extra) => {
            if (extra.action !== 'sort') return;
            const selected = Array.isArray(sorter) ? sorter[0] : sorter;
            const key = selected?.columnKey;
            const order = selected?.order;
            setSort(
              (key === 'date' || key === 'entries' || key === 'productEntries') &&
                (order === 'ascend' || order === 'descend')
                ? { key, order }
                : null,
            );
            setPage(1);
          }}
          scroll={{ x: 760 }}
          pagination={{
            ...CLIENT_TABLE_PAGINATION,
            current: page,
            pageSize,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1);
              setPageSize(nextPageSize);
            },
          }}
          locale={{ emptyText: <Empty description={t('emptyBatches')} /> }}
        />
      </div>
      {editing !== undefined && (
        <BatchEditorDrawer
          batch={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(batch) => {
            setItems((current) =>
              current.some((item) => item.id === batch.id)
                ? current.map((item) => (item.id === batch.id ? batch : item))
                : [batch, ...current],
            );
          }}
        />
      )}
    </>
  );
}
