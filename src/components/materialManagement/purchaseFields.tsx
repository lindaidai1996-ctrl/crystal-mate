'use client';

import { Alert, Checkbox, Form, InputNumber, Radio } from 'antd';
import { useTranslations } from 'next-intl';
import type { MaterialAmount, MaterialValues } from '@/lib/client-types';
import {
  calculatePurchase,
  editPurchase,
  type MaterialPurchase,
  type PurchaseTotalField,
} from '@/lib/material-purchase';

export function MaterialAmountInput({
  value,
  onChange,
  suffix,
  label,
  positive = false,
}: {
  value: MaterialAmount;
  onChange: (value: MaterialAmount) => void;
  suffix: string;
  label: string;
  positive?: boolean;
}) {
  return (
    <InputNumber<string>
      stringMode
      value={value}
      onChange={onChange}
      min={positive ? '0.01' : '0'}
      max="9999999999.99"
      step="0.01"
      precision={2}
      suffix={suffix}
      aria-label={label}
      style={{ width: '100%' }}
    />
  );
}

export function PurchaseFields({
  values,
  purchase,
  quantity,
  quantityUnknown,
  onQuantityChange,
  onUnknownChange,
  onPurchaseChange,
  onModeChange,
  onValueChange,
}: {
  values: MaterialValues;
  purchase: MaterialPurchase;
  quantity: number | null;
  quantityUnknown: boolean;
  onQuantityChange: (value: number | null) => void;
  onUnknownChange: (value: boolean) => void;
  onPurchaseChange: (value: MaterialPurchase) => void;
  onModeChange: (mode: MaterialPurchase['mode']) => void;
  onValueChange: (field: keyof MaterialValues, value: string | number | null) => void;
}) {
  const t = useTranslations('materialEditor');
  const batchText = useTranslations('materialBatches');
  const unit = t(values.unit);
  const batch = purchase.mode === 'BATCH';
  const result = calculatePurchase(values, purchase, quantityUnknown ? null : quantity);
  const totalInput = (field: PurchaseTotalField, suffix: string, positive = false) => (
    <Form.Item label={t(field)}>
      <MaterialAmountInput
        value={result.purchase[field]}
        suffix={suffix}
        label={t(field)}
        positive={positive}
        onChange={(value) => onPurchaseChange(editPurchase(result.purchase, field, value))}
      />
      {result.purchase.autoField === field && (
        <div className="material-source-label">{t('autoCalculated')}</div>
      )}
    </Form.Item>
  );
  if (values.unit === 'GRAM') {
    return (
      <section className="editor-block">
        <h2>{t('purchaseInformation')}</h2>
        <p className="material-input-help">{t('gramPurchaseHelp')}</p>
        <div className="material-field-grid material-three-columns">
          {totalInput('totalWeightGrams', 'g', true)}
          {totalInput('quotedGramPrice', t('yuanPerGram'))}
          {totalInput('totalAmount', t('yuan'))}
        </div>
        <p>
          {t('actualGramPrice')}: {result.values.purchaseGramPrice ?? '—'} {t('yuanPerGram')}
        </p>
        {result.difference !== null && result.difference !== '0.00' && (
          <Alert
            type="warning"
            showIcon
            message={t('purchaseDifference', { amount: result.difference })}
          />
        )}
        {result.belowPrecision && <Alert type="warning" showIcon message={t('belowPrecision')} />}
        {!result.valid && <div className="material-input-help">{t('gramValuesRequired')}</div>}
      </section>
    );
  }
  return (
    <section className="editor-block">
      <h2>{t('purchaseInformation')}</h2>
      <Form.Item label={t('inputMode')}>
        <Radio.Group
          value={purchase.mode}
          onChange={(event) => onModeChange(event.target.value)}
          options={[
            { value: 'UNIT', label: t('unitInputMode') },
            { value: 'BATCH', label: t('batchInputMode') },
          ]}
        />
      </Form.Item>
      <div className="material-field-grid material-three-columns">
        <Form.Item label={batchText('quantity')} required={!(batch && quantityUnknown)}>
          <InputNumber<number>
            value={batch && quantityUnknown ? null : quantity}
            onChange={onQuantityChange}
            disabled={batch && quantityUnknown}
            min={1}
            max={2147483647}
            precision={0}
            suffix={unit}
            aria-label={batchText('quantity')}
            style={{ width: '100%' }}
          />
          {batch && (
            <Checkbox
              checked={quantityUnknown}
              onChange={(event) => onUnknownChange(event.target.checked)}
            >
              {t('quantityUnknown')}
            </Checkbox>
          )}
        </Form.Item>
        {batch ? (
          <>
            {totalInput('quotedGramPrice', t('yuanPerGram'))}
            {totalInput('totalWeightGrams', 'g', true)}
            {totalInput('totalAmount', t('yuan'))}
          </>
        ) : (
          <>
            <Form.Item label={t('unitPurchasePrice', { unit })}>
              <MaterialAmountInput
                value={values.purchaseUnitPrice}
                label={t('unitPurchasePrice', { unit })}
                suffix={`${t('yuan')}/${unit}`}
                onChange={(value) => onValueChange('purchaseUnitPrice', value)}
              />
            </Form.Item>
            <Form.Item label={t('unitWeight', { unit })}>
              <MaterialAmountInput
                value={values.weightGrams}
                label={t('unitWeight', { unit })}
                suffix={`g/${unit}`}
                positive
                onChange={(value) => onValueChange('weightGrams', value)}
              />
            </Form.Item>
            <Form.Item label={t('purchaseGramPrice')}>
              <MaterialAmountInput
                value={values.purchaseGramPrice}
                label={t('purchaseGramPrice')}
                suffix={t('yuanPerGram')}
                onChange={(value) => onValueChange('purchaseGramPrice', value)}
              />
            </Form.Item>
          </>
        )}
      </div>
      {batch && (
        <>
          {result.difference !== null && result.difference !== '0.00' && (
            <Alert
              className="material-purchase-alert"
              type="warning"
              showIcon
              message={t('purchaseDifference', { amount: result.difference })}
            />
          )}
          {quantityUnknown && (
            <div className="material-field-grid">
              <Form.Item label={t('sampleWeight', { unit })}>
                <MaterialAmountInput
                  value={purchase.sampleWeightGrams}
                  label={t('sampleWeight', { unit })}
                  suffix={`g/${unit}`}
                  positive
                  onChange={(value) =>
                    onPurchaseChange({ ...result.purchase, sampleWeightGrams: value })
                  }
                />
                <div className="material-input-help">{t('sampleHelp')}</div>
              </Form.Item>
            </div>
          )}
          <Form.Item label={t('manualUnitPrice', { unit })}>
            <MaterialAmountInput
              value={purchase.manualUnitPrice}
              label={t('manualUnitPrice', { unit })}
              suffix={`${t('yuan')}/${unit}`}
              onChange={(value) => onPurchaseChange({ ...result.purchase, manualUnitPrice: value })}
            />
            <div className="material-input-help">{t('manualPriceHelp')}</div>
          </Form.Item>
          <div className="material-purchase-results" aria-live="polite">
            <h3 className="material-subheading">{t('calculationResults')}</h3>
            <dl>
              <div>
                <dt>
                  {t(result.source === 'AVERAGE' ? 'averageUnitPrice' : 'unitPurchasePrice', {
                    unit,
                  })}
                </dt>
                <dd>
                  {result.values.purchaseUnitPrice ?? t('pendingQuantity')}
                  {result.values.purchaseUnitPrice !== null && ` ${t('yuan')}/${unit}`}
                  {(result.source === 'ESTIMATED' || result.source === 'MANUAL') && (
                    <span className="material-source-label">
                      {' '}
                      · {t(`priceSource_${result.source}`)}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  {t(quantityUnknown ? 'estimatedUnitWeight' : 'averageUnitWeight', { unit })}
                </dt>
                <dd>
                  {result.values.weightGrams ?? t('pendingQuantity')}
                  {result.values.weightGrams !== null && ` g/${unit}`}
                </dd>
              </div>
              <div>
                <dt>{t('actualGramPrice')}</dt>
                <dd>
                  {result.values.purchaseGramPrice ?? '—'} {t('yuanPerGram')}
                </dd>
              </div>
            </dl>
          </div>
          {result.belowPrecision && <Alert type="warning" showIcon message={t('belowPrecision')} />}
          {!result.valid && <div className="material-input-help">{t('batchValuesRequired')}</div>}
        </>
      )}
    </section>
  );
}
