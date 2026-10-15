'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Empty, Input, Popconfirm, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialBatch } from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { BatchEditorDrawer } from './batchEditorDrawer';
import { ImageHoverPreview } from './imageHoverPreview';

export function MaterialBatchesPage() {
  const t = useTranslations('materialBatches');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [items, setItems] = useState<MaterialBatch[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MaterialBatch | null | undefined>(undefined);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? items.filter((item) => item.name.toLocaleLowerCase().includes(term)) : items;
  }, [items, query]);

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
          <ImageHoverPreview images={item.attachments ?? []} name={item.name} />
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
      render: (_, item) => item.receivedAt.slice(0, 10),
    },
    {
      title: t('materialCount'),
      key: 'entries',
      width: 130,
      render: (_, item) => item._count?.entries ?? 0,
    },
    {
      title: t('productCount'),
      key: 'productEntries',
      width: 130,
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          allowClear
        />
      </div>
      <div className="table-surface">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={visible}
          loading={loading}
          scroll={{ x: 760 }}
          pagination={CLIENT_TABLE_PAGINATION}
          locale={{ emptyText: <Empty description={t('emptyBatches')} /> }}
        />
      </div>
      {editing !== undefined && (
        <BatchEditorDrawer
          batch={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(batch) =>
            setItems((current) =>
              current.some((item) => item.id === batch.id)
                ? current.map((item) => (item.id === batch.id ? batch : item))
                : [batch, ...current],
            )
          }
        />
      )}
    </>
  );
}
