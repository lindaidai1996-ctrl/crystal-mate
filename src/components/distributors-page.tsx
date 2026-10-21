'use client';

import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { App, Button, Drawer, Empty, Form, Input, Modal, Popconfirm, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { PaginatedTable } from '@/components/paginated-table';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  Distributor,
  DistributorArea,
  DistributorListItem,
  DistributorPage,
} from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { DistributorEditorDrawer } from './distributor-editor-drawer';

export function DistributorsPage() {
  const t = useTranslations('distributors');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [areaForm] = Form.useForm<{ name: string }>();
  const [items, setItems] = useState<DistributorListItem[]>([]);
  const [savedAreas, setSavedAreas] = useState<string[]>([]);
  const [areaItems, setAreaItems] = useState<DistributorArea[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingArea, setSavingArea] = useState(false);
  const [editing, setEditing] = useState<Distributor | null | undefined>(undefined);
  const [managingAreas, setManagingAreas] = useState(false);
  const [editingArea, setEditingArea] = useState<DistributorArea | null | undefined>(undefined);

  const errorMessage = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<DistributorPage>('/api/distributors');
      setItems(data.items);
      setSavedAreas(data.areas);
      setAreaItems(data.areaItems);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [message, errorMessage]);
  useEffect(() => {
    apiFetch<DistributorPage>('/api/distributors')
      .then((data) => {
        setItems(data.items);
        setSavedAreas(data.areas);
        setAreaItems(data.areaItems);
      })
      .catch((error) => message.error(errorMessage(error)))
      .finally(() => setLoading(false));
  }, [message, errorMessage]);

  const areaLabel = useCallback(
    (area: string) => {
      if (area === '东海') return t('donghai');
      if (area === '可塘') return t('ketang');
      if (area === '网络') return t('online');
      return area;
    },
    [t],
  );
  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [item.name, item.area, areaLabel(item.area), item.address, item.wechat, item.phone].some(
        (value) => value.toLocaleLowerCase().includes(term),
      ),
    );
  }, [items, query, areaLabel]);

  function open(item: Distributor | null) {
    setEditing(item);
  }
  async function remove(id: string) {
    try {
      await apiFetch(`/api/distributors/${id}`, { method: 'DELETE' });
      message.success(common('deleted'));
      await load();
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  function openArea(item: DistributorArea | null) {
    setEditingArea(item);
    areaForm.setFieldsValue({ name: item?.name ?? '' });
  }
  async function saveArea() {
    const values = await areaForm.validateFields().catch(() => null);
    if (!values) return;
    setSavingArea(true);
    try {
      await apiFetch(
        editingArea ? `/api/distributor-areas/${editingArea.id}` : '/api/distributor-areas',
        { method: editingArea ? 'PUT' : 'POST', body: JSON.stringify(values) },
      );
      message.success(common('saved'));
      setEditingArea(undefined);
      await load();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSavingArea(false);
    }
  }
  async function removeArea(id: string) {
    try {
      await apiFetch(`/api/distributor-areas/${id}`, { method: 'DELETE' });
      message.success(common('deleted'));
      await load();
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  async function copyContact(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      message.success(t('copied'));
    } catch {
      message.error(t('copyFailed'));
    }
  }

  const columns: ColumnsType<DistributorListItem> = [
    {
      title: t('name'),
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (name: string, item: Distributor) => (
        <Link className="product-name" href={`/admin/distributors/${item.id}`}>
          {name}
        </Link>
      ),
    },
    { title: t('area'), dataIndex: 'area', key: 'area', width: 110, render: areaLabel },
    {
      title: (
        <Tooltip title={t('address')}>
          <span>{t('address')}</span>
        </Tooltip>
      ),
      dataIndex: 'address',
      key: 'address',
      ellipsis: { showTitle: false },
      render: (address: string) => (
        <Tooltip title={address}>
          <span>{address}</span>
        </Tooltip>
      ),
    },
    {
      title: t('contact'),
      key: 'contact',
      width: 240,
      render: (_, item) => (
        <div className="distributor-contacts">
          {(['wechat', 'phone'] as const).map((field) => (
            <div className="distributor-contact" key={field}>
              <span className="distributor-contact-label">{t(field)}</span>
              <span className="distributor-contact-value">{item[field] || '—'}</span>
              {item[field] && (
                <Tooltip title={t('copyContact', { field: t(field) })}>
                  <Button
                    className="distributor-contact-copy"
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label={t('copyContact', { field: t(field) })}
                    onClick={() => void copyContact(item[field])}
                  />
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: (
        <Tooltip title={t('itemCountsHint')}>
          <span>{t('itemCounts')}</span>
        </Tooltip>
      ),
      key: 'itemCounts',
      width: 190,
      render: (_, { itemCounts }) => (
        <div className="distributor-item-counts">
          <div className="distributor-item-total">
            <span>{t('totalItems')}</span>
            <strong>{itemCounts.total.toLocaleString()}</strong>
          </div>
          <div className="distributor-item-breakdown">
            <span>
              {t('products')} <strong>{itemCounts.products.toLocaleString()}</strong>
            </span>
            <span>
              {t('materials')} <strong>{itemCounts.materials.toLocaleString()}</strong>
            </span>
          </div>
        </div>
      ),
    },
    {
      title: (
        <Tooltip title={t('notes')}>
          <span>{t('notes')}</span>
        </Tooltip>
      ),
      dataIndex: 'notes',
      key: 'notes',
      ellipsis: { showTitle: false },
      render: (notes: string) => (
        <Tooltip title={notes}>
          <span>{notes}</span>
        </Tooltip>
      ),
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 210,
      render: (_, item) => (
        <span className="row-actions">
          <Link href={`/admin/distributors/${item.id}`}>
            <Button type="text" icon={<EyeOutlined />}>
              {t('viewDetails')}
            </Button>
          </Link>
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
  const areaColumns: ColumnsType<DistributorArea> = [
    { title: t('area'), dataIndex: 'name', key: 'name', render: areaLabel },
    {
      title: t('distributorCount'),
      dataIndex: 'distributorCount',
      key: 'distributorCount',
      width: 110,
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 100,
      render: (_, item) => (
        <span className="row-actions">
          <Tooltip title={common('edit')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              aria-label={common('edit')}
              onClick={() => openArea(item)}
            />
          </Tooltip>
          <Popconfirm
            title={t('deleteAreaConfirm')}
            okText={common('delete')}
            cancelText={common('cancel')}
            onConfirm={() => removeArea(item.id)}
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
        <div className="page-heading-actions">
          <Button icon={<EnvironmentOutlined />} onClick={() => setManagingAreas(true)}>
            {t('manageAreas')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>
            {t('new')}
          </Button>
        </div>
      </div>
      <div className="filter-bar">
        <Input.Search
          className="filter-search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
      </div>
      <div className="table-surface">
        <PaginatedTable
          rowKey="id"
          dataSource={visibleItems}
          columns={columns}
          loading={loading}
          scroll={{ x: 1200 }}
          pagination={CLIENT_TABLE_PAGINATION}
          locale={{ emptyText: <Empty description={t('empty')} /> }}
        />
      </div>
      {editing !== undefined && (
        <DistributorEditorDrawer
          distributor={editing}
          areas={savedAreas}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await load();
          }}
        />
      )}
      <Drawer
        title={t('manageAreas')}
        placement="right"
        open={managingAreas}
        onClose={() => setManagingAreas(false)}
        width="min(520px, 100vw)"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openArea(null)}>
            {t('newArea')}
          </Button>
        }
      >
        <PaginatedTable
          rowKey="id"
          dataSource={areaItems}
          columns={areaColumns}
          loading={loading}
          pagination={CLIENT_TABLE_PAGINATION}
          size="small"
          scroll={{ x: 400 }}
          locale={{ emptyText: <Empty description={t('emptyAreas')} /> }}
        />
        <Modal
          title={editingArea ? t('editArea') : t('newArea')}
          open={editingArea !== undefined}
          onCancel={() => setEditingArea(undefined)}
          onOk={saveArea}
          okText={common('save')}
          cancelText={common('cancel')}
          confirmLoading={savingArea}
          forceRender
        >
          <Form form={areaForm} layout="vertical" onFinish={saveArea}>
            <Form.Item
              name="name"
              label={t('area')}
              rules={[{ required: true, whitespace: true, max: 60 }]}
            >
              <Input maxLength={60} autoFocus />
            </Form.Item>
          </Form>
        </Modal>
      </Drawer>
    </>
  );
}
