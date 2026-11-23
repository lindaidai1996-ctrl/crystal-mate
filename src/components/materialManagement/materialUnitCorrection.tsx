'use client';

import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Form,
  InputNumber,
  Radio,
  Space,
  Spin,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ResponsiveModal } from '@/components/responsive/responsiveDialog';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialUnit } from '@/lib/client-types';
import {
  unitCorrectionEditsSchema,
  type UnitCorrectionChange,
  type UnitCorrectionEdits,
  type UnitCorrectionPricing,
  type UnitCorrectionPreview,
} from '@/lib/material-unit-correction';
import { CompactFields } from '@/components/responsive/compactFields';
import correctionStyles from './materialUnitCorrection.module.css';

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
  const [edits, setEdits] = useState<UnitCorrectionEdits>();
  const [needsPreview, setNeedsPreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [loadRevision, setLoadRevision] = useState(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    apiFetch<UnitCorrectionPreview>(`/api/materials/${id}/unit-correction`, {
      method: 'POST',
      body: JSON.stringify({ unit: target }),
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPreview(result);
        setEdits(result.edits);
        setNeedsPreview(false);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof ClientApiError ? error.code : 'SERVER_ERROR');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [id, open, target, loadRevision]);

  function revise(next: UnitCorrectionEdits) {
    setEdits(next);
    setNeedsPreview(true);
    setConfirmed(false);
    setError(undefined);
  }
  async function updatePreview() {
    if (!target || !edits || saving || loading) return;
    const parsed = unitCorrectionEditsSchema.safeParse(edits);
    if (!parsed.success) {
      message.error(t('invalidValues'));
      return;
    }
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setLoading(true);
    setConfirmed(false);
    setError(undefined);
    try {
      const result = await apiFetch<UnitCorrectionPreview>(`/api/materials/${id}/unit-correction`, {
        method: 'POST',
        body: JSON.stringify({ unit: target, edits: parsed.data }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPreview(result);
      setEdits(result.edits);
      setNeedsPreview(false);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof ClientApiError ? error.code : 'SERVER_ERROR');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function submit() {
    if (!preview || !edits || needsPreview || !confirmed || saving || loading) return;
    setSaving(true);
    try {
      await apiFetch(`/api/materials/${id}/unit-correction`, {
        method: 'PATCH',
        body: JSON.stringify({
          unit: preview.to,
          edits,
          snapshot: preview.snapshot,
          confirmed: true,
        }),
      });
      message.success(t('success'));
      setOpen(false);
      onCorrected();
    } catch (error) {
      setError(error instanceof ClientApiError ? error.code : 'SERVER_ERROR');
      setNeedsPreview(true);
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
      [
        'purchaseInputMode',
        'unitPriceSource',
        'childPriceSource',
        'purchaseAutoField',
        'saleRule',
      ].includes(field)
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
  function amountInput(
    label: string,
    input: string | null,
    change: (value: string | null) => void,
    quantity = false,
    required = false,
  ) {
    return (
      <Form.Item layout="vertical" label={label} required={required}>
        <InputNumber<string>
          aria-label={label}
          value={input}
          stringMode
          min="0"
          max={quantity ? '2147483647' : '9999999999.99'}
          precision={2}
          step={quantity && target !== 'GRAM' ? '1' : '0.01'}
          disabled={saving || loading}
          placeholder={required ? t('requiredValue') : t('unknownOrUnset')}
          style={{ width: '100%' }}
          onChange={change}
        />
      </Form.Item>
    );
  }
  function pricingFields(
    input: UnitCorrectionPricing,
    change: (field: keyof UnitCorrectionPricing, value: string | null) => void,
  ) {
    const suffix = target ? editor(target) : '';
    return (
      <CompactFields columns={2} className={correctionStyles.fields}>
        {amountInput(t('priceLabel', { unit: suffix }), input.purchaseUnitPrice, (value) =>
          change('purchaseUnitPrice', value),
        )}
        {amountInput(t('saleLabel', { unit: suffix }), input.saleUnitPrice, (value) =>
          change('saleUnitPrice', value),
        )}
        {amountInput(t('baseLabel', { unit: suffix }), input.baseSaleUnitPrice, (value) =>
          change('baseSaleUnitPrice', value),
        )}
        {target !== 'GRAM' && (
          <>
            {amountInput(t('fields.weightGrams'), input.weightGrams, (value) =>
              change('weightGrams', value),
            )}
            {amountInput(t('fields.purchaseGramPrice'), input.purchaseGramPrice, (value) =>
              change('purchaseGramPrice', value),
            )}
            {amountInput(t('fields.saleGramPrice'), input.saleGramPrice, (value) =>
              change('saleGramPrice', value),
            )}
            {amountInput(t('fields.baseSaleGramPrice'), input.baseSaleGramPrice, (value) =>
              change('baseSaleGramPrice', value),
            )}
          </>
        )}
      </CompactFields>
    );
  }
  const blocked = preview?.entries.some(
    (entry) => entry.issues.length || entry.diy.some((line) => line.conflict),
  );
  const quantity = (input: string | null) =>
    input === null ? t('unknown') : `${Number(input)} ${editor(unit)}`;

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
          setEdits(undefined);
          setError(undefined);
          setConfirmed(false);
          setLoading(false);
          setNeedsPreview(false);
          setOpen(true);
        }}
      >
        {t('action')}
      </Button>
      <ResponsiveModal
        open={open}
        title={t('title')}
        width={820}
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
        okButtonProps={{
          'aria-label': t('confirm'),
          disabled: !preview || !!blocked || needsPreview || !confirmed || loading || !!error,
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t('help')} />
          <Form.Item label={t('target')}>
            <Radio.Group
              value={target}
              disabled={saving}
              onChange={(event) => {
                pending.current?.abort();
                setPreview(undefined);
                setEdits(undefined);
                setConfirmed(false);
                setError(undefined);
                setNeedsPreview(false);
                setLoading(true);
                setTarget(event.target.value);
              }}
              options={(['STRAND', 'BEAD', 'GRAM'] as const)
                .filter((value) => value !== unit)
                .map((value) => ({ value, label: editor(value) }))}
            />
          </Form.Item>
          {loading && <Spin />}
          {error && (
            <Alert
              type="error"
              showIcon
              message={common(`errors.${error}` as never)}
              action={
                <Button
                  disabled={saving || loading}
                  onClick={() => {
                    setPreview(undefined);
                    setEdits(undefined);
                    setError(undefined);
                    setConfirmed(false);
                    setLoading(true);
                    setNeedsPreview(false);
                    setLoadRevision((value) => value + 1);
                  }}
                >
                  {t('reload')}
                </Button>
              }
            />
          )}
          {preview && edits && (
            <>
              <strong>
                {preview.name} · {editor(preview.from)} → {editor(preview.to)}
              </strong>
              <p>{t('scope', { count: preview.entries.length })}</p>
              {(preview.from === 'GRAM' || preview.to === 'GRAM') && (
                <Alert type="info" showIcon message={t('gramWarning')} />
              )}
              {preview.from === 'STRAND' && (
                <Alert type="warning" showIcon message={t('childWarning')} />
              )}
              <section>
                <h3>{t('master')}</h3>
                {pricingFields(edits.master, (field, value) =>
                  revise({ ...edits, master: { ...edits.master, [field]: value } }),
                )}
              </section>
              {preview.entries.map((entry, index) => {
                const input = edits.entries[index];
                const setEntry = (patch: Partial<typeof input>) =>
                  revise({
                    ...edits,
                    entries: edits.entries.map((row, i) =>
                      i === index ? { ...row, ...patch } : row,
                    ),
                  });
                const unitLabel = editor(preview.to);
                return (
                  <section key={entry.id}>
                    <h3>
                      {entry.batch} · {entry.distributor}
                    </h3>
                    <p>
                      {t('originalQuantities', {
                        received: quantity(entry.receivedQty),
                        remaining: quantity(entry.remainingQty),
                      })}
                    </p>
                    <CompactFields columns={2} className={correctionStyles.fields}>
                      {amountInput(
                        `${t('received')}（${unitLabel}）`,
                        input.receivedQty,
                        (value) => setEntry({ receivedQty: value }),
                        true,
                        target === 'GRAM',
                      )}
                      {amountInput(
                        `${t('remaining')}（${unitLabel}）`,
                        input.remainingQty,
                        (value) => setEntry({ remainingQty: value }),
                        true,
                      )}
                      {amountInput(
                        t('fields.purchaseTotalAmount'),
                        input.purchaseTotalAmount,
                        (value) => setEntry({ purchaseTotalAmount: value }),
                      )}
                      {target !== 'GRAM' &&
                        amountInput(
                          t('fields.purchaseTotalWeightGrams'),
                          input.purchaseTotalWeightGrams,
                          (value) => setEntry({ purchaseTotalWeightGrams: value }),
                        )}
                    </CompactFields>
                    {pricingFields(input, (field, value) => setEntry({ [field]: value }))}
                    <p>{t('purchaseHelp')}</p>
                    {entry.adjustments.length > 0 && (
                      <details>
                        <summary>{t('adjustments', { count: entry.adjustments.length })}</summary>
                        <Alert type="warning" showIcon message={t('historyHelp')} />
                        {entry.adjustments.map((row, rowIndex) => (
                          <section key={row.id}>
                            <h4>
                              {row.createdAt.slice(0, 10)} · {row.reason}
                            </h4>
                            <p>
                              {quantity(row.beforeQty)} → {quantity(row.afterQty)}
                            </p>
                            <CompactFields columns={2} className={correctionStyles.fields}>
                              {amountInput(
                                t('beforeQty', { unit: unitLabel }),
                                input.adjustments[rowIndex].beforeQty,
                                (value) =>
                                  setEntry({
                                    adjustments: input.adjustments.map((record, i) =>
                                      i === rowIndex ? { ...record, beforeQty: value } : record,
                                    ),
                                  }),
                                true,
                              )}
                              {amountInput(
                                t('afterQty', { unit: unitLabel }),
                                input.adjustments[rowIndex].afterQty || null,
                                (value) =>
                                  setEntry({
                                    adjustments: input.adjustments.map((record, i) =>
                                      i === rowIndex
                                        ? { ...record, afterQty: value ?? '' }
                                        : record,
                                    ),
                                  }),
                                true,
                                true,
                              )}
                            </CompactFields>
                          </section>
                        ))}
                      </details>
                    )}
                    {!needsPreview &&
                      entry.issues.map((issue) => (
                        <Alert
                          key={issue}
                          type="error"
                          showIcon
                          message={t(`issues.${issue}` as never)}
                        />
                      ))}
                    {entry.diy.length > 0 && (
                      <>
                        <p>{t('diyHelp')}</p>
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
                      </>
                    )}
                  </section>
                );
              })}
              {needsPreview && <Alert type="info" showIcon message={t('previewNeeded')} />}
              <Button
                aria-label={t('previewAction')}
                onClick={() => void updatePreview()}
                loading={loading}
                disabled={saving}
              >
                {t('previewAction')}
              </Button>
              {!needsPreview && (
                <details>
                  <summary>{t('previewTitle')}</summary>
                  {changeList(preview.masterChanges)}
                  {preview.entries.map((entry) => (
                    <section key={entry.id}>
                      <h4>
                        {entry.batch} · {entry.distributor}
                      </h4>
                      {changeList(entry.changes)}
                      {entry.adjustments.map((row, index) => {
                        const after = edits.entries.find((input) => input.id === entry.id)!
                          .adjustments[index];
                        if (row.beforeQty === after.beforeQty && row.afterQty === after.afterQty)
                          return null;
                        return (
                          <p key={row.id}>
                            {row.createdAt.slice(0, 10)} · {row.reason}: {quantity(row.beforeQty)} →{' '}
                            {after.beforeQty ?? t('unknown')} {editor(preview.to)};{' '}
                            {quantity(row.afterQty)} → {after.afterQty} {editor(preview.to)}
                          </p>
                        );
                      })}
                    </section>
                  ))}
                </details>
              )}
              <Checkbox
                checked={confirmed}
                disabled={!!blocked || needsPreview || loading || saving || !!error}
                onChange={(event) => setConfirmed(event.target.checked)}
              >
                {t('acknowledge')}
              </Checkbox>
            </>
          )}
          {!preview && !loading && target && (
            <Button
              onClick={() => {
                setLoading(true);
                setError(undefined);
                setLoadRevision((value) => value + 1);
              }}
            >
              {common('retry')}
            </Button>
          )}
        </Space>
      </ResponsiveModal>
    </>
  );
}
