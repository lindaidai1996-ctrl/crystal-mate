'use client';

import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Button, Empty, Popconfirm, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { PaginatedTable } from '@/components/paginated-table';
import { MaterialStockButton } from '@/components/inventory/materialStockButton';
import type { MaterialBatchDetail } from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { ImageHoverPreview } from './imageHoverPreview';

export type BatchEntryType = 'all' | 'product' | 'material';
type BatchEntryRow =
  | { type: 'product'; entry: MaterialBatchDetail['productEntries'][number] }
  | { type: 'material'; entry: MaterialBatchDetail['entries'][number] };

export function BatchDetailEntriesTable({
  batch,
  type,
  onRemove,
  onStockSaved,
}: {
  batch: MaterialBatchDetail;
  type: BatchEntryType;
  onRemove: (entry: MaterialBatchDetail['entries'][number]) => Promise<void>;
  onStockSaved: () => void | Promise<void>;
}) {
  const t = useTranslations('materialBatches');
  const common = useTranslations('common');
  const inventory = useTranslations('inventory');
  const editor = useTranslations('materialEditor');
  const rows: BatchEntryRow[] = [
    ...batch.productEntries.map((entry) => ({ type: 'product' as const, entry })),
    ...batch.entries.map((entry) => ({ type: 'material' as const, entry })),
  ]
    .filter((row) => type === 'all' || row.type === type)
    .sort(
      (a, b) =>
        b.entry.createdAt.localeCompare(a.entry.createdAt) ||
        `${a.type}:${a.entry.id}`.localeCompare(`${b.type}:${b.entry.id}`),
    );

  const columns: ColumnsType<BatchEntryRow> = [
    {
      title: t('type'),
      key: 'type',
      width: 80,
      fixed: 'left',
      render: (_, row) => <Tag color={row.type === 'product' ? 'blue' : 'gold'}>{t(row.type)}</Tag>,
    },
    {
      title: t('item'),
      key: 'item',
      width: 240,
      fixed: 'left',
      render: (_, row) => {
        const product = row.type === 'product' ? row.entry.product : null;
        const name = row.type === 'product' ? row.entry.product.name : row.entry.material.name;
        const itemId = row.type === 'product' ? row.entry.productId : row.entry.materialId;
        return (
          <div className="product-cell">
            <ImageHoverPreview
              images={row.type === 'product' ? row.entry.product.images : row.entry.images}
              name={name}
            />
            <div>
              <Link
                className="product-name"
                href={`/admin/${row.type === 'product' ? 'products' : 'materials'}/${itemId}`}
              >
                {name}
              </Link>
              {product && <div className="product-code">{product.code}</div>}
            </div>
          </div>
        );
      },
    },
    {
      title: t('source'),
      key: 'source',
      width: 120,
      render: (_, row) => row.entry.distributor.name,
    },
    {
      title: t('quantity'),
      key: 'quantity',
      width: 110,
      render: (_, row) =>
        row.type === 'product'
          ? `${row.entry.quantity} ${t('PIECE')}`
          : row.entry.receivedQty === null
            ? t('quantityUnknown', { unit: t(row.entry.material.unit) })
            : `${row.entry.receivedQty} ${t(row.entry.material.unit)}`,
    },
    ...(type !== 'product'
      ? ([
          {
            title: inventory('current'),
            key: 'stock',
            width: 110,
            render: (_, row) =>
              row.type === 'material'
                ? `${row.entry.remainingQty ?? inventory('unknown')} ${t(row.entry.material.unit)}`
                : '—',
          },
        ] satisfies ColumnsType<BatchEntryRow>)
      : []),
    ...(type !== 'product'
      ? ([
          {
            title: t('totalWeightGrams'),
            key: 'totalWeightGrams',
            width: 110,
            render: (_, row) =>
              row.type === 'material' && row.entry.purchase.totalWeightGrams !== null
                ? `${row.entry.purchase.totalWeightGrams} g`
                : '—',
          },
          {
            title: t('totalAmount'),
            key: 'totalAmount',
            width: 100,
            render: (_, row) =>
              row.type === 'material' ? (row.entry.purchase.totalAmount ?? '—') : '—',
          },
        ] satisfies ColumnsType<BatchEntryRow>)
      : []),
    {
      title: t('purchaseUnitPrice'),
      key: 'purchaseUnitPrice',
      width: 130,
      render: (_, row) =>
        row.type === 'product' ? (
          row.entry.unitCost
        ) : (
          <span>
            {row.entry.purchaseUnitPrice ?? '—'}
            {row.entry.material.unit === 'GRAM' && ` ${editor('yuanPerGram')}`}
            {(row.entry.unitPriceSource === 'ESTIMATED' ||
              row.entry.unitPriceSource === 'MANUAL') && (
              <span className="material-source-label">
                {' '}
                · {t(`priceSource_${row.entry.unitPriceSource}`)}
              </span>
            )}
          </span>
        ),
    },
    ...(type !== 'product'
      ? ([
          {
            title: t('gramPrice'),
            key: 'gramPrice',
            width: 100,
            render: (_, row) =>
              row.type === 'material' ? (row.entry.purchaseGramPrice ?? '—') : '—',
          },
        ] satisfies ColumnsType<BatchEntryRow>)
      : []),
    {
      title: t('salePrice'),
      key: 'salePrice',
      width: 100,
      render: (_, row) =>
        row.type === 'product' ? (
          (row.entry.product.priceCents / 100).toFixed(2)
        ) : (
          <div>
            <div>
              {row.entry.saleUnitPrice ?? '—'}
              {row.entry.material.unit === 'GRAM' && ` ${editor('yuanPerGram')}`}
            </div>
            {row.entry.material.unit === 'STRAND' && row.entry.saleChildUnitPrice !== null && (
              <div className="material-source-label">
                <div>{t('saleBeadPrice')}</div>
                <div>
                  {row.entry.saleChildUnitPrice} {editor('yuanPerBead')}
                </div>
              </div>
            )}
          </div>
        ),
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 190,
      render: (_, row) => (
        <span className="row-actions">
          {row.type === 'material' && (
            <MaterialStockButton
              allowDecimals={row.entry.material.unit === 'GRAM'}
              materialId={row.entry.materialId}
              name={row.entry.material.name}
              unit={t(row.entry.material.unit)}
              entries={[row.entry]}
              onSaved={onStockSaved}
            />
          )}
          <Link
            href={
              row.type === 'product'
                ? `/admin/products/${row.entry.productId}`
                : `/admin/materials/${row.entry.materialId}/batches/${row.entry.id}`
            }
          >
            <Tooltip title={common('edit')}>
              <Button type="text" icon={<EditOutlined />} aria-label={common('edit')} />
            </Tooltip>
          </Link>
          {row.type === 'material' && (
            <Popconfirm
              title={inventory('deleteMaterialEntry')}
              okText={common('delete')}
              cancelText={common('cancel')}
              onConfirm={() => onRemove(row.entry)}
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
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="table-surface">
      <PaginatedTable
        key={type}
        rowKey={(row) => `${row.type}:${row.entry.id}`}
        dataSource={rows}
        columns={columns}
        scroll={{ x: type === 'product' ? 970 : 1390 }}
        pagination={CLIENT_TABLE_PAGINATION}
        locale={{
          emptyText: (
            <Empty
              description={
                type === 'product'
                  ? t('emptyProducts')
                  : type === 'material'
                    ? t('empty')
                    : t('emptyItems')
              }
            />
          ),
        }}
      />
    </div>
  );
}
