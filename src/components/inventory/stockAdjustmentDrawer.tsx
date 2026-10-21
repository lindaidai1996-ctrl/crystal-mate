'use client';

import { Alert, App, Button, Drawer, Form, Input, InputNumber, Skeleton } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { ProductStockAdjustment, StockAdjustment } from '@/lib/client-types';
import { MAX_STOCK, validMaterialQuantity } from '@/lib/inventory';
import { StockHistory } from './stockHistory';
import inventoryStyles from './inventory.module.css';

type StockResource = {
  stock?: number;
  remainingQty?: number | null;
  stockAdjustments: (StockAdjustment | ProductStockAdjustment)[];
};

export function StockAdjustmentDrawer({
  name,
  resourceUrl,
  unit,
  allowDecimals = false,
  onClose,
  onSaved,
}: {
  name: string;
  resourceUrl: string;
  unit?: string;
  allowDecimals?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations('inventory');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [form] = Form.useForm<{ quantity: number; reason: string }>();
  const [snapshot, setSnapshot] = useState<StockResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  const expectedQuantity = snapshot?.stock ?? snapshot?.remainingQty ?? null;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<StockResource>(resourceUrl, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setSnapshot(value);
        setError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof ClientApiError ? err.code : 'SERVER_ERROR');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [resourceUrl, revision, form]);

  useEffect(() => {
    if (!loading && snapshot) {
      form.setFieldsValue({
        quantity: snapshot.stock ?? snapshot.remainingQty ?? undefined,
        reason: '',
      });
    }
  }, [snapshot, loading, form]);

  async function save(values: { quantity: number; reason: string }) {
    if (!snapshot || error) return;
    setSaving(true);
    try {
      const value = await apiFetch<StockResource>(`${resourceUrl}/stock-adjustments`, {
        method: 'POST',
        body: JSON.stringify({
          quantity: values.quantity,
          expectedQuantity,
          reason: values.reason ?? '',
        }),
      });
      setSnapshot(value);
      setSaved(true);
      message.success(common('saved'));
      await onSaved();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.code : 'SERVER_ERROR');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={t('adjust')}
      open
      width="min(480px, 100vw)"
      onClose={onClose}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      extra={
        <Button
          type="primary"
          loading={saving}
          disabled={loading || !!error || saved}
          onClick={() => form.submit()}
        >
          {common('save')}
        </Button>
      }
    >
      <div className={inventoryStyles.content}>
        <strong>{name}</strong>
        {error && (
          <Alert
            type="warning"
            showIcon
            message={common(`errors.${error}` as never)}
            action={
              <Button
                size="small"
                onClick={() => {
                  setLoading(true);
                  setSaved(false);
                  setRevision((value) => value + 1);
                }}
              >
                {t('refresh')}
              </Button>
            }
          />
        )}
        {loading ? (
          <Skeleton active />
        ) : (
          snapshot && (
            <>
              <p>
                {t('current')}: {expectedQuantity ?? t('unknown')} {unit}
              </p>
              <Form
                form={form}
                layout="vertical"
                onFinish={(values) => void save(values)}
                disabled={saving || !!error}
              >
                <Form.Item
                  name="quantity"
                  label={t('actual')}
                  rules={[
                    {
                      required: true,
                      message: t(allowDecimals ? 'weightInvalid' : 'quantityInvalid'),
                    },
                    {
                      validator: (_, value) =>
                        typeof value === 'number' &&
                        validMaterialQuantity(value, allowDecimals ? 'GRAM' : 'BEAD')
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error(t(allowDecimals ? 'weightInvalid' : 'quantityInvalid')),
                            ),
                    },
                  ]}
                >
                  <InputNumber
                    min={0}
                    max={MAX_STOCK}
                    precision={allowDecimals ? 2 : 0}
                    step={allowDecimals ? 0.01 : 1}
                    className={inventoryStyles.number}
                    onChange={() => setSaved(false)}
                    suffix={unit}
                  />
                </Form.Item>
                <Form.Item name="reason" label={t('reason')}>
                  <Input.TextArea
                    rows={2}
                    maxLength={500}
                    placeholder={t('defaultReason')}
                    onChange={() => setSaved(false)}
                  />
                </Form.Item>
              </Form>
              <StockHistory records={snapshot.stockAdjustments} />
            </>
          )
        )}
      </div>
    </Drawer>
  );
}
