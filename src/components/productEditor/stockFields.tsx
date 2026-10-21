'use client';

import { Alert, Button, Form, Input, InputNumber } from 'antd';
import { useTranslations } from 'next-intl';
import { MAX_STOCK } from '@/lib/inventory';

export function StockFields({
  isNew,
  currentStock,
  conflict,
  refreshing,
  onRefresh,
}: {
  isNew: boolean;
  currentStock?: number;
  conflict: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const inventory = useTranslations('inventory');
  const stock: number | null | undefined = Form.useWatch('stock');
  const changed =
    !isNew &&
    currentStock !== undefined &&
    typeof stock === 'number' &&
    Number.isInteger(stock) &&
    stock >= 0 &&
    stock <= MAX_STOCK &&
    stock !== currentStock;

  return (
    <div className="editor-field-stock" hidden={isNew}>
      <Form.Item
        name="stock"
        label={t('stock')}
        extra={changed ? t('stockChange', { before: currentStock, after: stock }) : undefined}
        rules={[
          { required: true, message: t('required') },
          {
            validator: (_, value) =>
              value == null || (Number.isInteger(value) && value >= 0 && value <= MAX_STOCK)
                ? Promise.resolve()
                : Promise.reject(new Error(t('stockInvalid'))),
          },
        ]}
      >
        <InputNumber
          disabled={conflict || refreshing}
          min={0}
          max={MAX_STOCK}
          precision={0}
          step={1}
          style={{ width: '100%' }}
        />
      </Form.Item>
      {changed && (
        <Form.Item name="stockReason" label={t('stockAdjustmentReason')}>
          <Input.TextArea rows={2} maxLength={500} placeholder={inventory('defaultReason')} />
        </Form.Item>
      )}
      {conflict && (
        <Alert
          type="warning"
          showIcon
          message={common('errors.STOCK_CHANGED')}
          action={
            <Button size="small" loading={refreshing} onClick={onRefresh}>
              {inventory('refresh')}
            </Button>
          }
          style={{ marginBottom: 24 }}
        />
      )}
    </div>
  );
}
