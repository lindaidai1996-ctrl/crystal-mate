'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Empty, Form, Input, Modal, Popconfirm, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { PaginatedTable } from '@/components/paginated-table';
import { TextTag } from '@/components/text-tag';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { SettingStyle } from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION, DEFAULT_TABLE_PAGE_SIZE } from '@/lib/table-pagination';
import { useSessionListState } from './useSessionListState';

export function SettingStylesPage() {
  const t = useTranslations('settingStyles');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [form] = Form.useForm<{ magicBoxStyle: string }>();
  const [items, setItems] = useState<SettingStyle[]>([]);
  const [query, setQuery] = useSessionListState('setting-styles:query', '');
  const [page, setPage] = useSessionListState('setting-styles:page', 1);
  const [pageSize, setPageSize] = useSessionListState(
    'setting-styles:pageSize',
    DEFAULT_TABLE_PAGE_SIZE,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SettingStyle | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    apiFetch<SettingStyle[]>('/api/setting-styles')
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(true);
        message.error(
          common(
            `errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never,
          ),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [message, common, loadRevision]);

  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return items.filter((item) => item.magicBoxStyle.toLocaleLowerCase().includes(term));
  }, [items, query]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visibleItems.length / pageSize)));

  function open(item: SettingStyle | null) {
    setEditing(item);
    form.setFieldsValue({ magicBoxStyle: item?.magicBoxStyle ?? '' });
  }

  async function save(values: { magicBoxStyle: string }) {
    if (saving) return;
    setSaving(true);
    try {
      const item = await apiFetch<SettingStyle>(
        editing ? `/api/setting-styles/${editing.id}` : '/api/setting-styles',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(values),
        },
      );
      setItems((current) =>
        editing
          ? current.map((entry) => (entry.id === item.id ? { ...entry, ...item } : entry))
          : [...current, item],
      );
      setEditing(undefined);
      message.success(common('saved'));
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/setting-styles/${id}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.id !== id));
      message.success(common('deleted'));
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    }
  }

  const columns: ColumnsType<SettingStyle> = [
    {
      title: t('magicBoxStyle'),
      dataIndex: 'magicBoxStyle',
      key: 'magicBoxStyle',
      render: (name: string) => <TextTag text={name} />,
      sorter: (a, b) => a.magicBoxStyle.localeCompare(b.magicBoxStyle, 'zh-CN'),
      defaultSortOrder: 'ascend',
    },
    {
      title: t('productCount'),
      dataIndex: 'productCount',
      key: 'productCount',
      render: (count: number, item) => (
        <Link href={`/admin/catalog/cabochons?settingStyleId=${encodeURIComponent(item.id)}`}>
          {count}
        </Link>
      ),
      sorter: (a, b) => a.productCount - b.productCount,
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
        {loadError && (
          <Button
            onClick={() => {
              setLoading(true);
              setLoadError(false);
              setLoadRevision((value) => value + 1);
            }}
          >
            {common('retry')}
          </Button>
        )}
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
        onCancel={() => {
          if (!saving) setEditing(undefined);
        }}
        onOk={() => form.submit()}
        okText={common('save')}
        cancelText={common('cancel')}
        confirmLoading={saving}
        afterClose={() => form.resetFields()}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={save}
          onFinishFailed={() => message.error(common('checkRequiredFields'))}
        >
          <Form.Item
            name="magicBoxStyle"
            label={t('magicBoxStyle')}
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input maxLength={60} autoFocus disabled={saving} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
