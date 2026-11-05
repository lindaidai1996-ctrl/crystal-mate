'use client';

import { DeleteOutlined, FileTextOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Empty, List, Popconfirm, Space, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { withAdminReturnTo } from '@/lib/admin-return-path';

export type EditorDraftKind = 'MATERIAL' | 'PRODUCT';
export type EditorDraftRecord<T> = {
  id: string;
  kind: EditorDraftKind;
  title: string;
  data: T;
  updatedAt: string;
};

type DraftSummary = Pick<EditorDraftRecord<unknown>, 'id' | 'title' | 'updatedAt'>;

export function EditorDraftBox({ kind, returnTo }: { kind: EditorDraftKind; returnTo: string }) {
  const t = useTranslations('editorDrafts');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DraftSummary[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    apiFetch<DraftSummary[]>(`/api/editor-drafts?kind=${kind}`)
      .then((drafts) => {
        if (active) setItems(drafts);
      })
      .catch((error) => {
        if (active)
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
  }, [open, kind, message, common]);

  async function remove(id: string) {
    setRemoving(id);
    try {
      await apiFetch(`/api/editor-drafts/${id}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.id !== id));
      message.success(common('deleted'));
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      <Button
        icon={<FileTextOutlined />}
        onClick={() => {
          setLoading(true);
          setOpen(true);
        }}
      >
        {t('box')}
      </Button>
      <Drawer title={t('box')} open={open} onClose={() => setOpen(false)} width="min(480px, 100vw)">
        {loading ? (
          <Spin />
        ) : items.length ? (
          <List
            dataSource={items}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Link
                    key="continue"
                    href={withAdminReturnTo(
                      `/admin/${kind === 'MATERIAL' ? 'materials' : 'products'}/new?draftId=${encodeURIComponent(item.id)}`,
                      returnTo,
                    )}
                  >
                    {t('continue')}
                  </Link>,
                  <Popconfirm
                    key="delete"
                    title={t('deleteConfirm')}
                    onConfirm={() => void remove(item.id)}
                  >
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={common('delete')}
                      loading={removing === item.id}
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={item.title || t('untitled')}
                  description={
                    <Space size={4}>
                      {t('updatedAt')}
                      {new Date(item.updatedAt).toLocaleString()}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty description={t('empty')} />
        )}
      </Drawer>
    </>
  );
}
