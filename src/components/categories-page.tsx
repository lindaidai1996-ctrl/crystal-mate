'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Empty, Form, Input, Modal, Popconfirm, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Category } from '@/lib/client-types';

export function CategoriesPage() {
  const t = useTranslations('categories');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string }>();
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
    form.setFieldsValue({ name: item?.name ?? '' });
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
          <Button
            type="text"
            icon={<EditOutlined />}
            title={common('edit')}
            aria-label={common('edit')}
            onClick={() => open(item)}
          />
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
        <h1>{t('title')}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>
          {t('new')}
        </Button>
      </div>
      <div className="table-surface">
        <Table
          rowKey="id"
          dataSource={items}
          columns={columns}
          loading={loading}
          pagination={false}
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
        </Form>
      </Modal>
    </>
  );
}
