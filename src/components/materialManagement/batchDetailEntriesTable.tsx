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
import { useSessionListState } from '@/components/useSessionListState';
import { withAdminReturnTo } from '@/lib/admin-return-path';

export type BatchEntryType = 'all' | 'product' | 'material';
type BatchEntryRow =
  | { type: 'product'; entry: MaterialBatchDetail['productEntries'][number] }
  | { type: 'material'; entry: MaterialBatchDetail['entries'][number] };

export function BatchDetailEntriesTable({
  batch,
  type,
  returnTo,
  onRemove,
  onStockSaved,
}: {
  batch: MaterialBatchDetail;
  type: BatchEntryType;
  returnTo: string;
  onRemove: (entry: MaterialBatchDetail['entries'][number]) => Promise<void>;
  onStockSaved: () => void | Promise<void>;
}) {
  const t = useTranslations('materialBatches');
  const common = useTranslations('common');
  const inventory = useTranslations('inventory');
  const editor = useTranslations('materialEditor');
  const [page, setPage] = useSessionListState(`material-batch-detail:${batch.id}:${type}:page`, 1);
  const [pageSize, setPageSize] = useSessionListState(
    `material-batch-detail:${batch.id}:${type}:pageSize`,
    20,
  );
  const price = (value: string | null, suffix: string) =>
    value === null ? '—' : `${value} ${suffix}`;
  const unitSuffix = (row: BatchEntryRow) =>
    row.type === 'product'
      ? `${editor('yuan')}/${t('PIECE')}`
      : editor(
          row.entry.material.unit === 'GRAM'
            ? 'yuanPerGram'
            : row.entry.material.unit === 'STRAND'
              ? 'yuanPerStrand'
              : 'yuanPerBead',
        );
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
      title: t('item'),
      key: 'item',
      width: 280,
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
                href={withAdminReturnTo(
                  `/admin/${row.type === 'product' ? 'products' : 'materials'}/${itemId}`,
                  returnTo,
                )}
              >
                {name}
              </Link>
              <div>
                <Tag color={row.type === 'product' ? 'blue' : 'gold'}>{t(row.type)}</Tag>
              </div>
              {product && <div className="product-code">{product.code}</div>}
              {row.type === 'material' && (
                <div className="material-source-label">
                  {row.entry.weightGrams !== null && (
                    <div>
                      {editor('unitWeight', { unit: t(row.entry.material.unit) })}:{' '}
                      {row.entry.weightGrams} g
                    </div>
                  )}
                  {row.entry.material.unit === 'STRAND' && row.entry.childCount !== null && (
                    <div>
                      {editor('childCount')}: {row.entry.childCount}
                    </div>
                  )}
                  {row.entry.material.unit === 'STRAND' && row.entry.childWeightGrams !== null && (
                    <div>
                      {editor('childWeightGrams')}: {row.entry.childWeightGrams} g
                    </div>
                  )}
                  {(['lengthMm', 'widthMm', 'heightMm'] as const).some(
                    (field) => row.entry[field] !== null,
                  ) && (
                    <div>
                      {(['lengthMm', 'widthMm', 'heightMm'] as const)
                        .filter((field) => row.entry[field] !== null)
                        .map((field) => `${editor(field)} ${row.entry[field]} mm`)
                        .join(' · ')}
                    </div>
                  )}
                </div>
              )}
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
      title: t('quantityAndStock'),
      key: 'quantity',
      width: 180,
      render: (_, row) => {
        if (row.type === 'product') return `${t('quantity')}: ${row.entry.quantity} ${t('PIECE')}`;
        const unit = t(row.entry.material.unit);
        return (
          <div className="material-batch-names">
            <div>
              {t('quantity')}:{' '}
              {row.entry.receivedQty === null
                ? t('quantityUnknown', { unit })
                : `${row.entry.receivedQty} ${unit}`}
            </div>
            <div>
              {inventory('current')}: {row.entry.remainingQty ?? inventory('unknown')} {unit}
            </div>
            <span className="material-price-summary">
              {t('totalWeightGrams')}:{' '}
              {row.entry.purchase.totalWeightGrams === null
                ? '—'
                : `${row.entry.purchase.totalWeightGrams} g`}
            </span>
          </div>
        );
      },
    },
    {
      title: t('priceDetails'),
      key: 'prices',
      width: 410,
      render: (_, row) => {
        const suffix = unitSuffix(row);
        if (row.type === 'product')
          return (
            <div className="material-batch-names">
              <div>
                {t('purchaseUnitPrice')}: {price(row.entry.unitCost, suffix)}
              </div>
              <div>
                {t('salePrice')}: {price((row.entry.product.priceCents / 100).toFixed(2), suffix)}
              </div>
            </div>
          );
        const { entry } = row;
        const gram = entry.material.unit === 'GRAM';
        const sourceLabel =
          entry.unitPriceSource === 'ESTIMATED' || entry.unitPriceSource === 'MANUAL'
            ? ` (${t(`priceSource_${entry.unitPriceSource}`)})`
            : '';
        const gramPrices = [
          `${t('gramPrice')}: ${price(entry.purchaseGramPrice, editor('yuanPerGram'))}`,
          ...(entry.saleGramPrice === null
            ? []
            : [`${t('saleGramPrice')}: ${price(entry.saleGramPrice, editor('yuanPerGram'))}`]),
        ];
        const beadPrices =
          entry.material.unit === 'STRAND'
            ? [
                ...(entry.childUnitPrice === null
                  ? []
                  : [
                      `${t('purchaseBeadPrice')}: ${price(entry.childUnitPrice, editor('yuanPerBead'))}`,
                    ]),
                ...(entry.saleChildUnitPrice === null
                  ? []
                  : [
                      `${t('saleBeadPrice')}: ${price(entry.saleChildUnitPrice, editor('yuanPerBead'))}`,
                    ]),
              ]
            : [];
        return (
          <div className="material-batch-names">
            <div>
              {t('purchaseUnitPrice')}: {price(entry.purchaseUnitPrice, suffix)}
              {sourceLabel}
              {' · '}
              {t('salePrice')}: {price(gram ? entry.saleGramPrice : entry.saleUnitPrice, suffix)}
            </div>
            {!gram && <span className="material-price-summary">{gramPrices.join(' · ')}</span>}
            {beadPrices.length > 0 && (
              <span className="material-price-summary">{beadPrices.join(' · ')}</span>
            )}
            <span className="material-price-summary">
              {t('totalAmount')}: {price(entry.purchase.totalAmount, editor('yuan'))}
            </span>
          </div>
        );
      },
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
            href={withAdminReturnTo(
              row.type === 'product'
                ? `/admin/products/${row.entry.productId}`
                : `/admin/materials/${row.entry.materialId}/batches/${row.entry.id}`,
              returnTo,
            )}
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
        scroll={{ x: 1180 }}
        pagination={{
          ...CLIENT_TABLE_PAGINATION,
          current: Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize))),
          pageSize,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPageSize === pageSize ? nextPage : 1);
            setPageSize(nextPageSize);
          },
        }}
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
