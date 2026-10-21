'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Empty, Form, Input, Modal, Popconfirm, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PaginatedTable } from '@/components/paginated-table';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Category } from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';

export function CategoriesPage() {
  const t = useTranslations('categories');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string; prefix?: string }>();
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Category | null | undefined>(undefined);

  const errorMessage = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiFetch<Category[]>('/api/categories'));
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [message, errorMessage]);
  useEffect(() => {
    apiFetch<Category[]>('/api/categories')
      .then(setItems)
      .catch((error) => message.error(errorMessage(error)))
      .finally(() => setLoading(false));
  }, [message, errorMessage]);

  function open(item: Category | null) {
    setEditing(item);
    form.setFieldsValue({ name: item?.name ?? '', prefix: item?.prefix ?? undefined });
  }
  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await apiFetch(editing ? `/api/categories/${editing.id}` : '/api/categories', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(values),
      });
      message.success(common('saved'));
      setEditing(undefined);
      await load();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    try {
      await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
      message.success(common('deleted'));
      await load();
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  const columns: ColumnsType<Category> = [
    { title: t('name'), dataIndex: 'name', key: 'name' },
    {
      title: t('prefix'),
      dataIndex: 'prefix',
      key: 'prefix',
      width: 120,
      render: (prefix: string | null) => prefix || '—',
    },
    {
      title: t('productCount'),
      key: 'count',
      width: 150,
      render: (_, item) => item._count?.products ?? 0,
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
              aria-label={common('edit')}
              onClick={() => open(item)}
            />
          </Tooltip>
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
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('count', { count: items.length })}</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>
          {t('new')}
        </Button>
      </div>
      <div className="table-surface">
        <PaginatedTable
          rowKey="id"
          dataSource={items}
          columns={columns}
          loading={loading}
          pagination={CLIENT_TABLE_PAGINATION}
          locale={{ emptyText: <Empty description={t('empty')} /> }}
        />
      </div>
      <Modal
        title={editing ? t('editTitle') : t('newTitle')}
        open={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        onOk={save}
        okText={common('save')}
        cancelText={common('cancel')}
        confirmLoading={saving}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            name="name"
            label={t('name')}
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input maxLength={60} autoFocus />
          </Form.Item>
          {editing && (
            <Form.Item
              name="prefix"
              label={t('prefix')}
              extra={t('prefixHelp')}
              rules={[{ required: true, whitespace: true, pattern: /^[A-Za-z]+$/, max: 20 }]}
            >
              <Input maxLength={20} style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
