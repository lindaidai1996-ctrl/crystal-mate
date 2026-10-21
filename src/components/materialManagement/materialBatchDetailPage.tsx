'use client';

import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import { App, Button, Descriptions, Empty, Result, Segmented, Skeleton } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialBatchDetail } from '@/lib/client-types';
import { CreatePurchaseButton } from '@/components/purchaseCreation/createPurchaseButton';
import { BatchEditorDrawer } from './batchEditorDrawer';
import { BatchAttachmentGallery } from './batchAttachmentGallery';
import { BatchDetailEntriesTable, type BatchEntryType } from './batchDetailEntriesTable';

export function MaterialBatchDetailPage({ id }: { id: string }) {
  const t = useTranslations('materialBatches');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [batch, setBatch] = useState<MaterialBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [tab, setTab] = useState<BatchEntryType | 'attachments'>('all');

  async function remove(entry: MaterialBatchDetail['entries'][number]) {
    try {
      await apiFetch(`/api/materials/${entry.materialId}/batches/${entry.id}`, {
        method: 'DELETE',
      });
      setBatch((current) =>
        current
          ? { ...current, entries: current.entries.filter((item) => item.id !== entry.id) }
          : current,
      );
      message.success(common('deleted'));
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    }
  }

  useEffect(() => {
    let active = true;
    apiFetch<MaterialBatchDetail>(`/api/material-batches/${id}`)
      .then((value) => {
        if (active) setBatch(value);
      })
      .catch((error) => {
        if (!active) return;
        setFailed(true);
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
  }, [id, message, common]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (failed || !batch) return <Result status="error" title={t('loadFailed')} />;
  return (
    <>
      <div className="page-heading editor-heading">
        <div>
          <Link href="/admin/materials/batches" className="back-link">
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>{batch.name}</h1>
        </div>
        <div className="page-heading-actions">
          <CreatePurchaseButton batchId={batch.id} />
          <Button icon={<EditOutlined />} disabled={editingImage} onClick={() => setEditing(true)}>
            {common('edit')}
          </Button>
        </div>
      </div>
      <Descriptions className="material-batch-summary" column={{ xs: 1, sm: 2, md: 3 }}>
        <Descriptions.Item label={t('date')}>{batch.receivedAt.slice(0, 10)}</Descriptions.Item>
        <Descriptions.Item label={t('notes')}>{batch.notes || '—'}</Descriptions.Item>
      </Descriptions>
      <div className="distributor-detail-type-filter">
        <Segmented<BatchEntryType | 'attachments'>
          value={tab}
          disabled={editingImage}
          onChange={setTab}
          style={{ background: 'var(--ant-color-fill-tertiary)' }}
          options={[
            { value: 'all', label: t('all') },
            { value: 'product', label: t('productsOnly') },
            { value: 'material', label: t('materialsOnly') },
            { value: 'attachments', label: t('attachments') },
          ]}
        />
      </div>
      {tab === 'attachments' ? (
        <section aria-label={t('attachments')}>
          {batch.attachments?.length ? (
            <BatchAttachmentGallery
              batch={batch}
              onUploadingChange={setEditingImage}
              onSaved={(saved) =>
                setBatch((current) => (current ? { ...current, ...saved } : current))
              }
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noAttachments')} />
          )}
        </section>
      ) : (
        <BatchDetailEntriesTable
          batch={batch}
          type={tab}
          onRemove={remove}
          onStockSaved={async () => {
            setBatch(await apiFetch<MaterialBatchDetail>(`/api/material-batches/${id}`));
          }}
        />
      )}
      {editing && (
        <BatchEditorDrawer
          batch={batch}
          onClose={() => setEditing(false)}
          onSaved={(saved) => setBatch((current) => (current ? { ...current, ...saved } : current))}
        />
      )}
    </>
  );
}
