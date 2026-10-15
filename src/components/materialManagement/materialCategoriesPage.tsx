'use client';

import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Cascader,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialCategory } from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { categoryDescendants, categoryPath, categoryTree } from './categoryTree';

type Values = { name: string; parentPath?: string[]; aliases: string[] };
type Row = MaterialCategory & { children?: Row[] };
// The forced Ant Design portal must not render during server hydration.
const subscribeToHydration = () => () => {};

export function MaterialCategoriesPage() {
  const t = useTranslations('materialCategories');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [items, setItems] = useState<MaterialCategory[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MaterialCategory | null | undefined>();
  const modalMounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  const errorText = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const categories = await apiFetch<MaterialCategory[]>('/api/material-categories');
      setItems(categories);
      setExpandedKeys(categories.filter((item) => item._count?.children).map((item) => item.id));
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [errorText, message]);
  useEffect(() => {
    apiFetch<MaterialCategory[]>('/api/material-categories')
      .then((categories) => {
        setItems(categories);
        setExpandedKeys(categories.filter((item) => item._count?.children).map((item) => item.id));
      })
      .catch((error) => message.error(errorText(error)))
      .finally(() => setLoading(false));
  }, [errorText, message]);

  function open(item: MaterialCategory | null, parent?: MaterialCategory) {
    setEditing(item);
    form.setFieldsValue({
      name: item?.name ?? '',
      aliases: item?.aliases ?? [],
      parentPath: parent
        ? categoryPath(parent.id, items)
        : item?.parentId
          ? categoryPath(item.parentId, items)
          : [],
    });
  }
  async function save() {
    let values: Values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await apiFetch(
        editing ? `/api/material-categories/${editing.id}` : '/api/material-categories',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: values.name,
            aliases: values.aliases ?? [],
            parentId: values.parentPath?.at(-1) ?? null,
          }),
        },
      );
      message.success(common('saved'));
      setEditing(undefined);
      await load();
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    try {
      await apiFetch(`/api/material-categories/${id}`, { method: 'DELETE' });
      message.success(common('deleted'));
      await load();
    } catch (error) {
      message.error(errorText(error));
    }
  }

  function rows(parentId: string | null): Row[] {
    return items
      .filter((item) => item.parentId === parentId)
      .map((item) => {
        const descendants = rows(item.id);
        return descendants.length ? { ...item, children: descendants } : item;
      });
  }
  const columns: ColumnsType<Row> = [
    { title: t('name'), dataIndex: 'name', key: 'name' },
    {
      title: t('materialCount'),
      key: 'count',
      width: 120,
      render: (_, item) => item._count?.materials ?? 0,
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 210,
      render: (_, item) => (
        <span className="row-actions">
          <Button type="text" icon={<PlusOutlined />} onClick={() => open(null, item)}>
            {t('addChild')}
          </Button>
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
  const parentOptions = categoryTree(
    items,
    editing ? categoryDescendants(editing.id, items) : new Set<string>(),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <Link href="/admin/materials" className="back-link">
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>{t('title')}</h1>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>
          {t('new')}
        </Button>
      </div>
      <div className="table-surface">
        <Table
          rowKey="id"
          dataSource={rows(null)}
          columns={columns}
          loading={loading}
          pagination={CLIENT_TABLE_PAGINATION}
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
          }}
          locale={{ emptyText: <Empty description={t('empty')} /> }}
        />
      </div>
      {modalMounted && (
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
              <Input maxLength={60} />
            </Form.Item>
            <Form.Item name="parentPath" label={t('parent')}>
              <Cascader
                options={parentOptions}
                showSearch
                changeOnSelect
                allowClear
                placeholder={t('root')}
              />
            </Form.Item>
            <Form.Item name="aliases" label={t('aliases')} extra={t('aliasesHelp')}>
              <Select mode="tags" tokenSeparators={[',', '，']} maxTagCount="responsive" />
            </Form.Item>
          </Form>
        </Modal>
      )}
    </>
  );
}
