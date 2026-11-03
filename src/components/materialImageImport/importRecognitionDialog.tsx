'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space } from 'antd';
import { useTranslations } from 'next-intl';
import type {
  ImageImport,
  ImportBox,
  ImportItem,
  ImportItemData,
  ImportRecognitionPreview,
} from '@/lib/materialImageImport/contracts';
import {
  applyRecognitionPreview,
  type RecognitionField,
} from '@/lib/materialImageImport/recognitionPatch';
import { importMaterialDraft, importQuantity } from '@/lib/materialImageImport/materialDraft';
import { calculatePurchase } from '@/lib/material-purchase';
import { CropPreview, ImportImageCanvas } from './importImageCanvas';
import importStyles from './materialImageImport.module.css';

type Boxes = { objectBox: ImportBox; priceBox: ImportBox | null };

export function ImportRecognitionDialog({
  job,
  item,
  busy,
  configured,
  onRecognize,
  onApply,
  onClose,
  errorText,
}: {
  job: ImageImport;
  item: ImportItem;
  busy: boolean;
  configured: boolean;
  onRecognize: (boxes: Boxes) => Promise<ImportRecognitionPreview>;
  onApply: (patch: Partial<ImportItemData>) => void;
  onClose: () => void;
  errorText: (error: unknown) => string;
}) {
  const t = useTranslations('imageImport');
  const [boxes, setBoxes] = useState<Boxes>({
    objectBox: item.data.objectBox,
    priceBox: item.data.priceBox,
  });
  const [preview, setPreview] = useState<ImportRecognitionPreview | null>(null);
  const [fields, setFields] = useState<RecognitionField[]>(['ranges', 'evidence']);
  const [error, setError] = useState<string | null>(null);
  const material = importMaterialDraft(item.data);
  const gram = material.values.unit === 'GRAM';
  const priceLabel = t(item.data.priceKind === 'SALE' ? 'sale' : gram ? 'gramQuote' : 'purchase');
  const canvasJob = {
    ...job,
    items: job.items.map((row) =>
      row.id === item.id ? { ...row, data: { ...row.data, ...boxes } } : row,
    ),
  };
  const next = preview ? applyRecognitionPreview(item.data, preview.data, fields) : null;
  const stale = preview !== null && preview.version !== job.version;

  function priceValue(data: ImportItemData) {
    const draft = importMaterialDraft(data);
    const { values } = calculatePurchase(draft.values, draft.purchase, importQuantity(data));
    if (data.priceKind === 'SALE') return gram ? values.saleGramPrice : values.saleUnitPrice;
    return gram ? draft.purchase.quotedGramPrice : values.purchaseUnitPrice;
  }

  function updateBoxes(nextBoxes: Boxes) {
    setBoxes(nextBoxes);
    setPreview(null);
    setError(null);
  }

  async function recognize() {
    setError(null);
    setPreview(null);
    try {
      const result = await onRecognize(boxes);
      setPreview(result);
      setBoxes({ objectBox: result.data.objectBox, priceBox: result.data.priceBox });
      setFields(['ranges', 'evidence']);
    } catch (error) {
      setError(errorText(error));
    }
  }

  function finish(patch: Partial<ImportItemData>) {
    onApply(patch);
    onClose();
  }

  return (
    <Modal
      open
      title={t('reframeTitle', { number: job.items.findIndex((row) => row.id === item.id) + 1 })}
      width="min(1280px, calc(100vw - 32px))"
      style={{ top: 24 }}
      onCancel={onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <Space wrap>
          <Button disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          {!preview && (
            <Button disabled={busy} onClick={() => finish({ ...boxes, reviewed: false })}>
              {t('saveBoxes')}
            </Button>
          )}
          <Button loading={busy} disabled={busy || !configured} onClick={recognize}>
            {t(preview ? 'retryItemRecognition' : 'recognizeCurrentItem')}
          </Button>
          {preview && (
            <Button
              type="primary"
              disabled={busy || stale || !fields.length}
              onClick={() => next && finish(next)}
            >
              {t('applyRecognition')}
            </Button>
          )}
        </Space>
      }
    >
      <p className={importStyles.hint}>{t('singleRecognitionHelp')}</p>
      {error && <Alert type="error" showIcon message={error} className={importStyles.notice} />}
      {!configured && (
        <Alert type="info" showIcon message={t('modelMissing')} className={importStyles.notice} />
      )}
      {stale && (
        <Alert
          type="warning"
          showIcon
          message={t('errors.IMPORT_CONFLICT')}
          className={importStyles.notice}
        />
      )}
      <div className={importStyles.recognitionLayout}>
        <ImportImageCanvas
          job={canvasJob}
          activeId={item.id}
          originalBoxes={item.data}
          disabled={busy}
          onBox={(field, box) => updateBoxes({ ...boxes, [field]: box })}
          onClearPrice={() => updateBoxes({ ...boxes, priceBox: null })}
        />
        <section
          className={importStyles.recognitionComparison}
          aria-label={t('recognitionComparison')}
          aria-live="polite"
        >
          <h3>{t(preview ? 'recognitionComparison' : 'currentSelection')}</h3>
          {preview ? (
            <>
              <Checkbox.Group
                value={fields}
                onChange={setFields}
                className={importStyles.recognitionChoices}
                disabled={busy || stale}
              >
                <Checkbox value="ranges">{t('applyRanges')}</Checkbox>
                <Checkbox value="evidence">{t('applyEvidence')}</Checkbox>
                <Checkbox value="price" disabled={preview.data.price === null}>
                  {t('applyRecognizedPrice', { field: priceLabel })}
                </Checkbox>
              </Checkbox.Group>
              <p className={importStyles.hint}>{t('keepConfigurationHelp')}</p>
              <table className={importStyles.comparisonTable}>
                <thead>
                  <tr>
                    <th>{t('comparisonField')}</th>
                    <th>{t('currentValue')}</th>
                    <th>{t('afterApply')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>{t('recognizedPriceLabel')}</th>
                    <td>{item.data.priceText || '—'}</td>
                    <td>{next?.priceText || '—'}</td>
                  </tr>
                  <tr>
                    <th>{priceLabel}</th>
                    <td>{priceValue(item.data) ?? '—'}</td>
                    <td>{next ? (priceValue(next) ?? '—') : '—'}</td>
                  </tr>
                </tbody>
              </table>
              {!!preview.data.warnings.length && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('checkRequired')}
                  description={preview.data.warnings.join('；')}
                />
              )}
            </>
          ) : (
            <p className={importStyles.hint}>{t('singleSelectionHelp')}</p>
          )}
          <div className={importStyles.rangeComparison}>
            {[
              { label: t('currentValue'), data: item.data },
              {
                label: t(preview ? 'recognizedValue' : 'currentSelection'),
                data: preview?.data ?? { ...item.data, ...boxes },
              },
            ].map(({ label, data }) => (
              <div key={label}>
                <strong>{label}</strong>
                <span className={importStyles.hint}>{t('thumbnail')}</span>
                <CropPreview
                  url={job.sourceUrl}
                  sourceRatio={job.width / job.height}
                  box={data.objectBox}
                  label={`${label} · ${t('thumbnail')}`}
                  size={150}
                />
                <span className={importStyles.hint}>{t('priceEvidence')}</span>
                {data.priceBox ? (
                  <CropPreview
                    url={job.sourceUrl}
                    sourceRatio={job.width / job.height}
                    box={data.priceBox}
                    label={`${label} · ${t('priceEvidence')}`}
                    size={110}
                  />
                ) : (
                  <span className={importStyles.hint}>{t('noPriceBox')}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
