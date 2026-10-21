'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Empty, Form, Input, Modal, Popconfirm, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PaginatedTable } from '@/components/paginated-table';
import { TextTag } from '@/components/text-tag';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Tag } from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION, DEFAULT_TABLE_PAGE_SIZE } from '@/lib/table-pagination';

export function TagsPage() {
  const t = useTranslations('tags');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string }>();
  const [items, setItems] = useState<Tag[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Tag | null | undefined>(undefined);

  const errorMessage = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiFetch<Tag[]>('/api/tags'));
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [message, errorMessage]);
  useEffect(() => {
    apiFetch<Tag[]>('/api/tags')
      .then(setItems)
      .catch((error) => message.error(errorMessage(error)))
      .finally(() => setLoading(false));
  }, [message, errorMessage]);

  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return items.filter((item) => item.name.toLocaleLowerCase().includes(term));
  }, [items, query]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visibleItems.length / pageSize)));

  function open(item: Tag | null) {
    setEditing(item);
    form.setFieldsValue({ name: item?.name ?? '' });
  }
  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await apiFetch(editing ? `/api/tags/${editing.id}` : '/api/tags', {
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
      await apiFetch(`/api/tags/${id}`, { method: 'DELETE' });
      message.success(common('deleted'));
      await load();
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  const columns: ColumnsType<Tag> = [
    {
      title: t('name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <TextTag text={name} />,
      width: '25%',
      sorter: (a, b) => a.name.localeCompare(b.name, 'zh-CN'),
      defaultSortOrder: 'ascend',
    },
    {
      title: t('productCount'),
      key: 'count',
      width: '30%',
      sorter: (a, b) => (a._count?.products ?? 0) - (b._count?.products ?? 0),
      render: (_, item) => item._count?.products ?? 0,
    },
    {
      title: t('materialCount'),
      key: 'materialCount',
      width: '30%',
      sorter: (a, b) => (a._count?.materials ?? 0) - (b._count?.materials ?? 0),
      render: (_, item) => item._count?.materials ?? 0,
    },
    {
      title: t('actions'),
      key: 'actions',
      width: '15%',
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
          <p>{t('count', { count: visibleItems.length })}</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>
          {t('new')}
        </Button>
      </div>
      <div className="filter-bar">
        <Input.Search
          className="filter-search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          allowClear
        />
      </div>
      <div className="table-surface">
        <PaginatedTable
          rowKey="id"
          dataSource={visibleItems}
          columns={columns}
          loading={loading}
          tableLayout="fixed"
          sortDirections={['ascend', 'descend']}
          onChange={(_, __, ___, extra) => {
            if (extra.action === 'sort') setPage(1);
          }}
          pagination={{
            ...CLIENT_TABLE_PAGINATION,
            current: currentPage,
            pageSize,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPageSize === pageSize ? nextPage : 1);
              setPageSize(nextPageSize);
            },
          }}
          locale={{ emptyText: <Empty description={query.trim() ? t('noResults') : t('empty')} /> }}
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
