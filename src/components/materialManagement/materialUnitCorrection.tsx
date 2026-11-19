'use client';

import { Alert, App, Button, Checkbox, Descriptions, Form, Radio, Space, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ResponsiveModal } from '@/components/responsive/responsiveDialog';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialUnit } from '@/lib/client-types';
import type { UnitCorrectionChange, UnitCorrectionPreview } from '@/lib/material-unit-correction';

export function MaterialUnitCorrection({
  id,
  unit,
  dirty,
  disabled,
  onCorrected,
}: {
  id: string;
  unit: MaterialUnit;
  dirty: boolean;
  disabled: boolean;
  onCorrected: () => void;
}) {
  const t = useTranslations('materialUnitCorrection');
  const editor = useTranslations('materialEditor');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<MaterialUnit>();
  const [preview, setPreview] = useState<UnitCorrectionPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!open || !target) return;
    const controller = new AbortController();
    apiFetch<UnitCorrectionPreview>(`/api/materials/${id}/unit-correction`, {
      method: 'POST',
      body: JSON.stringify({ unit: target }),
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof ClientApiError ? error.code : 'SERVER_ERROR');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, open, target, revision]);

  function resetPreview() {
    setPreview(undefined);
    setConfirmed(false);
    setError(undefined);
    setLoading(true);
  }
  async function submit() {
    if (!preview || !confirmed || saving) return;
    setSaving(true);
    try {
      await apiFetch(`/api/materials/${id}/unit-correction`, {
        method: 'PATCH',
        body: JSON.stringify({ unit: preview.to, snapshot: preview.snapshot, confirmed: true }),
      });
      message.success(t('success'));
      setOpen(false);
      onCorrected();
    } catch (error) {
      setError(error instanceof ClientApiError ? error.code : 'SERVER_ERROR');
      setPreview(undefined);
      setConfirmed(false);
    } finally {
      setSaving(false);
    }
  }
  function value(field: string, input: UnitCorrectionChange['before']) {
    if (input === null) return t('unset');
    if (typeof input === 'boolean') return input ? common('yes') : common('no');
    if (field === 'purchaseUnitInputs') return t('savedInput');
    if (
      ['purchaseInputMode', 'unitPriceSource', 'childPriceSource', 'purchaseAutoField'].includes(
        field,
      )
    )
      return t(`values.${input}` as never);
    return String(input);
  }
  function changeList(changes: UnitCorrectionChange[]) {
    return (
      changes.length > 0 && (
        <Descriptions
          size="small"
          column={1}
          items={changes.map((change) => ({
            key: change.field,
            label: t(`fields.${change.field}` as never),
            children: `${value(change.field, change.before)} → ${value(change.field, change.after)}`,
          }))}
        />
      )
    );
  }
  const blocked = preview?.entries.some(
    (entry) => entry.issues.length || entry.diy.some((line) => line.conflict),
  );
  const quantity = (input: string | null, selectedUnit: MaterialUnit) =>
    input === null ? t('unknown') : `${Number(input)} ${editor(selectedUnit)}`;

  return (
    <>
      <Button
        type="link"
        style={{ minHeight: 44, paddingInline: 0 }}
        disabled={disabled}
        onClick={() => {
          if (dirty) {
            message.info(t('saveFirst'));
            return;
          }
          setTarget(undefined);
          setPreview(undefined);
          setError(undefined);
          setConfirmed(false);
          setLoading(false);
          setOpen(true);
        }}
      >
        {t('action')}
      </Button>
      <ResponsiveModal
        open={open}
        title={t('title')}
        width={720}
        styles={{ body: { maxHeight: '65dvh', overflowY: 'auto' } }}
        onCancel={() => {
          if (!saving) setOpen(false);
        }}
        onOk={() => void submit()}
        okText={t('confirm')}
        cancelText={common('cancel')}
        confirmLoading={saving}
        closable={!saving}
        maskClosable={!saving}
        cancelButtonProps={{ disabled: saving }}
        okButtonProps={{ disabled: !preview || !!blocked || !confirmed || loading || !!error }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t('help')} />
          <Form layout="vertical">
            <Form.Item label={t('target')}>
              <Radio.Group
                value={target}
                disabled={saving}
                onChange={(event) => {
                  resetPreview();
                  setTarget(event.target.value);
                }}
                options={(['STRAND', 'BEAD', 'GRAM'] as const)
                  .filter((value) => value !== unit)
                  .map((value) => ({ value, label: editor(value) }))}
              />
            </Form.Item>
          </Form>
          {loading && <Spin />}
          {error && (
            <Alert
              type="error"
              showIcon
              message={common(`errors.${error}` as never)}
              action={
                <Button
                  size="small"
                  onClick={() => {
                    resetPreview();
                    setRevision((value) => value + 1);
                  }}
                >
                  {common('retry')}
                </Button>
              }
            />
          )}
          {preview && (
            <>
              <strong>
                {preview.name} · {editor(preview.from)} → {editor(preview.to)}
              </strong>
              <p>{t('scope', { count: preview.entries.length })}</p>
              <p>{t('diyHelp')}</p>
              {preview.from === 'STRAND' && (
                <Alert type="warning" showIcon message={t('childWarning')} />
              )}
              {(preview.from === 'GRAM' || preview.to === 'GRAM') && (
                <Alert type="warning" showIcon message={t('gramWarning')} />
              )}
              {preview.masterChanges.length > 0 && (
                <section>
                  <h3>{t('master')}</h3>
                  {changeList(preview.masterChanges)}
                </section>
              )}
              {preview.entries.map((entry) => (
                <section key={entry.id}>
                  <h3>
                    {entry.batch} · {entry.distributor}
                  </h3>
                  <Descriptions
                    size="small"
                    column={1}
                    items={[
                      {
                        key: 'received',
                        label: t('received'),
                        children: `${quantity(entry.receivedQty, preview.from)} → ${quantity(entry.receivedQty, preview.to)}`,
                      },
                      {
                        key: 'remaining',
                        label: t('remaining'),
                        children: `${quantity(entry.remainingQty, preview.from)} → ${quantity(entry.remainingQty, preview.to)}`,
                      },
                      ...(['purchaseUnitPrice', 'saleUnitPrice'] as const).map((field) => ({
                        key: field,
                        label: editor(field),
                        children:
                          entry[field] === null
                            ? t('unset')
                            : t('priceChange', {
                                price: entry[field],
                                from: editor(preview.from),
                                to: editor(preview.to),
                              }),
                      })),
                    ]}
                  />
                  {entry.adjustmentCount > 0 && (
                    <p>{t('adjustments', { count: entry.adjustmentCount })}</p>
                  )}
                  {changeList(entry.changes)}
                  {entry.issues.map((issue) => (
                    <Alert
                      key={issue}
                      type="error"
                      showIcon
                      message={t(`issues.${issue}` as never)}
                    />
                  ))}
                  {entry.diy.length > 0 && (
                    <ul>
                      {entry.diy.map((line) => (
                        <li key={line.id}>
                          <Link href={`/admin/products/${line.productId}`}>{line.name}</Link> ·{' '}
                          {editor(line.unit)}
                          {line.conflict && (
                            <Alert type="error" showIcon message={t('issues.DIY')} />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
              <Checkbox
                checked={confirmed}
                disabled={!!blocked || saving}
                onChange={(event) => setConfirmed(event.target.checked)}
              >
                {t('acknowledge')}
              </Checkbox>
            </>
          )}
        </Space>
      </ResponsiveModal>
    </>
  );
}
