'use client';

import { ArrowLeftOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Descriptions,
  Empty,
  Image,
  Popconfirm,
  Result,
  Skeleton,
  Table,
  Tooltip,
} from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  MaterialBatch,
  MaterialBatchEntry,
  MaterialUnit,
  ProductPurchaseEntry,
} from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { BatchEditorDrawer } from './batchEditorDrawer';
import { ImageHoverPreview } from './imageHoverPreview';

type BatchDetail = MaterialBatch & {
  entries: (MaterialBatchEntry & { material: { id: string; name: string; unit: MaterialUnit } })[];
  productEntries: (ProductPurchaseEntry & {
    product: { id: string; code: string; name: string };
  })[];
};

export function MaterialBatchDetailPage({ id }: { id: string }) {
  const t = useTranslations('materialBatches');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  async function remove(entry: BatchDetail['entries'][number]) {
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
    apiFetch<BatchDetail>(`/api/material-batches/${id}`)
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
        <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
          {common('edit')}
        </Button>
      </div>
      <Descriptions className="material-batch-summary" column={{ xs: 1, sm: 2, md: 3 }}>
        <Descriptions.Item label={t('date')}>{batch.receivedAt.slice(0, 10)}</Descriptions.Item>
        <Descriptions.Item label={t('notes')}>{batch.notes || '—'}</Descriptions.Item>
      </Descriptions>
      <div className="table-surface">
        <Table
          rowKey="id"
          dataSource={batch.entries}
          scroll={{ x: 900 }}
          pagination={CLIENT_TABLE_PAGINATION}
          locale={{ emptyText: <Empty description={t('empty')} /> }}
          columns={[
            {
              title: t('material'),
              key: 'material',
              render: (_, item) => (
                <div className="product-cell">
                  <ImageHoverPreview images={item.images} name={item.material.name} />
                  <Link className="product-name" href={`/admin/materials/${item.materialId}`}>
                    {item.material.name}
                  </Link>
                </div>
              ),
            },
            {
              title: t('source'),
              key: 'source',
              render: (_, item) => item.distributor.name,
            },
            {
              title: t('quantity'),
              key: 'quantity',
              render: (_, item) =>
                item.receivedQty === null
                  ? t('quantityUnknown', { unit: t(item.material.unit) })
                  : `${item.remainingQty} / ${item.receivedQty} ${t(item.material.unit)}`,
            },
            {
              title: t('totalWeightGrams'),
              key: 'totalWeightGrams',
              render: (_, item) =>
                item.purchase.totalWeightGrams === null
                  ? '—'
                  : `${item.purchase.totalWeightGrams} g`,
            },
            {
              title: t('totalAmount'),
              key: 'totalAmount',
              render: (_, item) => item.purchase.totalAmount ?? '—',
            },
            {
              title: t('purchaseUnitPrice'),
              dataIndex: 'purchaseUnitPrice',
              key: 'purchaseUnitPrice',
              render: (value: string | null, item) => (
                <span>
                  {value ?? '—'}
                  {(item.unitPriceSource === 'ESTIMATED' || item.unitPriceSource === 'MANUAL') && (
                    <span className="material-source-label">
                      {' '}
                      · {t(`priceSource_${item.unitPriceSource}`)}
                    </span>
                  )}
                </span>
              ),
            },
            {
              title: t('gramPrice'),
              dataIndex: 'purchaseGramPrice',
              key: 'purchaseGramPrice',
              render: (value: string | null) => value ?? '—',
            },
            {
              title: t('salePrice'),
              dataIndex: 'saleUnitPrice',
              key: 'saleUnitPrice',
              render: (value: string | null) => value ?? '—',
            },
            {
              title: t('actions'),
              key: 'actions',
              render: (_, item) => (
                <span className="row-actions">
                  <Link href={`/admin/materials/${item.materialId}/batches/${item.id}`}>
                    <Tooltip title={common('edit')}>
                      <Button type="text" icon={<EditOutlined />} aria-label={common('edit')} />
                    </Tooltip>
                  </Link>
                  <Popconfirm
                    title={t('deleteEntry')}
                    okText={common('delete')}
                    cancelText={common('cancel')}
                    onConfirm={() => remove(item)}
                  >
                    <Tooltip title={common('delete')}>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={common('delete')}
                      />
                    </Tooltip>
                  </Popconfirm>
                </span>
              ),
            },
          ]}
        />
      </div>
      <section className="batch-detail-attachments">
        <h2>{t('product')}</h2>
        <div className="table-surface">
          <Table
            rowKey="id"
            dataSource={batch.productEntries}
            scroll={{ x: 650 }}
            pagination={CLIENT_TABLE_PAGINATION}
            locale={{ emptyText: <Empty description={t('emptyProducts')} /> }}
            columns={[
              {
                title: t('product'),
                key: 'product',
                render: (_, entry) => (
                  <Link href={`/admin/products/${entry.productId}`}>
                    {entry.product.name} · {entry.product.code}
                  </Link>
                ),
              },
              {
                title: t('source'),
                key: 'distributor',
                render: (_, entry) => entry.distributor.name,
              },
              { title: t('quantity'), dataIndex: 'quantity' },
              { title: t('purchaseUnitPrice'), dataIndex: 'unitCost' },
            ]}
          />
        </div>
      </section>
      <section className="batch-detail-attachments">
        <h2>{t('attachments')}</h2>
        {batch.attachments?.length ? (
          <div className="batch-detail-attachment-list">
            {batch.attachments.map((attachment) => (
              <div className="batch-detail-attachment" key={attachment.objectKey}>
                <Image src={attachment.url} alt={attachment.fileName} width={110} height={110} />
                {attachment.notes?.trim() && <p>{attachment.notes}</p>}
              </div>
            ))}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noAttachments')} />
        )}
      </section>
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
