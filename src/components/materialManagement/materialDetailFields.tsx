'use client';
import type { ReactNode } from 'react';
import { Button, Form, Input, InputNumber } from 'antd';
import { useTranslations } from 'next-intl';
import type {
  MaterialAmount,
  MaterialSaleRule,
  MaterialValues,
  ProductImage,
} from '@/lib/client-types';
import type { MaterialPurchase } from '@/lib/material-purchase';
import {
  adoptSaleUnitPriceFromBeads,
  childWeightFromStrand,
  purchaseCandidates,
  recalculateMaterial,
} from '@/lib/material-calculations';
import { ImagePicker } from '@/components/image-picker';
import { MaterialAmountInput, PurchaseFields } from './purchaseFields';
import { MaterialSaleFields } from './materialSaleFields';

export type MaterialDetailSection = 'purchase' | 'images' | 'strand' | 'sale' | 'notes';

export function MaterialDetailFields({
  values: draft,
  purchase,
  quantity: receivedQty,
  quantityUnknown,
  onQuantityChange: setReceivedQty,
  onUnknownChange: setQuantityUnknown,
  onPurchaseChange: setPurchase,
  onModeChange: changeMode,
  onChange: change,
  onRuleChange: changeRule,
  onValuesChange,
  images,
  onImagesChange: setImages,
  onUploadingChange: setUploadingImages,
  disabled = false,
  showDetails = true,
  showNotes = true,
  imagesExtra,
  maxImages,
  sections,
}: {
  values: MaterialValues;
  purchase: MaterialPurchase;
  quantity: number | null;
  quantityUnknown: boolean;
  onQuantityChange: (quantity: number | null) => void;
  onUnknownChange: (unknown: boolean) => void;
  onPurchaseChange: (purchase: MaterialPurchase) => void;
  onModeChange: (mode: MaterialPurchase['mode']) => void;
  onChange: (field: keyof MaterialValues, value: string | number | null) => void;
  onRuleChange: (rule: MaterialSaleRule) => void;
  onValuesChange: (values: MaterialValues) => void;
  images: ProductImage[];
  onImagesChange: (images: ProductImage[]) => void;
  onUploadingChange: (uploading: boolean) => void;
  disabled?: boolean;
  showDetails?: boolean;
  showNotes?: boolean;
  imagesExtra?: ReactNode;
  maxImages?: number;
  sections?: MaterialDetailSection[];
}) {
  const t = useTranslations('materialEditor');
  const candidates = purchaseCandidates(draft);
  const suggestedChildWeight = childWeightFromStrand(draft);
  const amount = (field: keyof MaterialValues, suffix: string, positive = false) => (
    <MaterialAmountInput
      value={draft[field] as MaterialAmount}
      suffix={suffix}
      label={t(field as never)}
      positive={positive}
      onChange={(value) => change(field, value)}
    />
  );
  return (
    <>
      {showDetails && (!sections || sections.includes('purchase')) && (
        <PurchaseFields
          values={draft}
          purchase={purchase}
          quantity={receivedQty}
          quantityUnknown={quantityUnknown}
          onQuantityChange={setReceivedQty}
          onUnknownChange={setQuantityUnknown}
          onPurchaseChange={setPurchase}
          onModeChange={changeMode}
          onValueChange={change}
        />
      )}
      {showDetails && (!sections || sections.includes('images')) && (
        <section className="editor-block">
          <h2>{t('images')}</h2>
          {imagesExtra}
          <ImagePicker
            images={images}
            onChange={setImages}
            onUploadingChange={setUploadingImages}
            disabled={disabled}
            maxImages={maxImages}
          />
        </section>
      )}
      {showDetails && (!sections || sections.includes('strand')) && draft.unit === 'STRAND' && (
        <section className="editor-block">
          <h2>{t('purchaseDetails')}</h2>
          <div className="material-field-grid material-three-columns">
            <Form.Item label={t('childCount')}>
              <InputNumber<number>
                value={draft.childCount}
                aria-label={t('childCount')}
                onChange={(value) => change('childCount', value)}
                min={1}
                max={2147483647}
                precision={0}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item label={t('childWeightGrams')}>
              {amount('childWeightGrams', 'g', true)}
              {suggestedChildWeight !== null && (
                <div className="material-price-suggestions" aria-live="polite">
                  <div>
                    <span>{t('suggestedChildWeight', { weight: suggestedChildWeight })}</span>
                    <Button
                      type="link"
                      size="small"
                      disabled={disabled}
                      onClick={() => change('childWeightGrams', suggestedChildWeight)}
                    >
                      {t('adopt')}
                    </Button>
                  </div>
                </div>
              )}
            </Form.Item>
            <Form.Item label={t('childUnitPrice')}>
              {amount('childUnitPrice', t('yuanPerBead'))}
              {draft.childPriceSource && draft.childPriceSource !== 'CUSTOM' && (
                <div className="material-source-label">{t(`source_${draft.childPriceSource}`)}</div>
              )}
              <div className="material-price-suggestions">
                <div>
                  <span>
                    {t('byCount')}: {candidates.count ?? '—'}
                  </span>
                  <Button
                    type="link"
                    size="small"
                    disabled={disabled || candidates.count === null}
                    onClick={() =>
                      onValuesChange(
                        recalculateMaterial({
                          ...draft,
                          childUnitPrice: candidates.count,
                          childPriceSource: 'COUNT',
                        }),
                      )
                    }
                  >
                    {t('adopt')}
                  </Button>
                </div>
                <div>
                  <span>
                    {t('byWeight')}: {candidates.weight ?? '—'}
                  </span>
                  <Button
                    type="link"
                    size="small"
                    disabled={disabled || candidates.weight === null}
                    onClick={() =>
                      onValuesChange(
                        recalculateMaterial({
                          ...draft,
                          childUnitPrice: candidates.weight,
                          childPriceSource: 'WEIGHT',
                        }),
                      )
                    }
                  >
                    {t('adopt')}
                  </Button>
                </div>
              </div>
            </Form.Item>
          </div>
        </section>
      )}
      {showDetails && (!sections || sections.includes('sale')) && (
        <MaterialSaleFields
          values={draft}
          onChange={change}
          onRuleChange={changeRule}
          onAdopt={() => onValuesChange(adoptSaleUnitPriceFromBeads(draft))}
        />
      )}
      {showNotes && (!sections || sections.includes('notes')) && (
        <section className="editor-block">
          <h2>{t('notes')}</h2>
          <Input.TextArea
            value={draft.notes}
            aria-label={t('notes')}
            onChange={(event) => change('notes', event.target.value)}
            maxLength={10000}
            rows={4}
            showCount
          />
        </section>
      )}
    </>
  );
}
