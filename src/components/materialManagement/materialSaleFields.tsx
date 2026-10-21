'use client';

import { Button, Form, Radio } from 'antd';
import { useTranslations } from 'next-intl';
import type { MaterialSaleRule, MaterialValues } from '@/lib/client-types';
import { saleUnitPriceFromBeads } from '@/lib/material-calculations';
import { MaterialAmountInput } from './purchaseFields';

export function MaterialSaleFields({
  values,
  onChange,
  onRuleChange,
  onAdopt,
}: {
  values: MaterialValues;
  onChange: (field: keyof MaterialValues, value: string | number | null) => void;
  onRuleChange: (rule: MaterialSaleRule) => void;
  onAdopt: () => void;
}) {
  const t = useTranslations('materialEditor');
  const strandPrice = saleUnitPriceFromBeads(values);
  const gram = values.unit === 'GRAM';
  const unitSuffix = t(
    gram ? 'yuanPerGram' : values.unit === 'STRAND' ? 'yuanPerStrand' : 'yuanPerBead',
  );
  const ruleValueLabel =
    values.saleRule === 'FIXED_AMOUNT'
      ? gram
        ? 'fixedAmountPerGram'
        : 'fixedAmount'
      : 'customPercent';
  const ruleValueSuffix =
    values.saleRule === 'FIXED_AMOUNT' ? (gram ? t('yuanPerGram') : t('yuan')) : '%';
  const amount = (
    field: 'saleRuleValue' | 'saleUnitPrice' | 'saleGramPrice' | 'saleChildUnitPrice',
    suffix: string,
  ) => (
    <MaterialAmountInput
      value={values[field]}
      onChange={(value) => onChange(field, value)}
      suffix={suffix}
      label={t(field === 'saleRuleValue' ? ruleValueLabel : field)}
    />
  );

  return (
    <section className="editor-block">
      <h2>{t('saleDetails')}</h2>
      <Form.Item
        label={t('saleRule')}
        extra={values.saleRule === 'CUSTOM_AMOUNT' ? t('customAmountHelp') : undefined}
      >
        <Radio.Group
          className="material-rule-options"
          value={values.saleRule}
          aria-label={t('saleRule')}
          onChange={(event) => onRuleChange(event.target.value)}
          options={(
            [
              'COST',
              'PERCENT_10',
              'PERCENT_20',
              'PERCENT_30',
              'PERCENT_50',
              'FIXED_AMOUNT',
              'CUSTOM_PERCENT',
              'CUSTOM_AMOUNT',
            ] as const
          ).map((rule) => ({ label: t(`rule_${rule}`), value: rule }))}
        />
      </Form.Item>
      {(values.saleRule === 'FIXED_AMOUNT' || values.saleRule === 'CUSTOM_PERCENT') && (
        <Form.Item label={t(ruleValueLabel)}>{amount('saleRuleValue', ruleValueSuffix)}</Form.Item>
      )}
      <div className="material-field-grid material-three-columns">
        {values.unit !== 'GRAM' && (
          <Form.Item label={t('saleUnitPrice')}>
            {amount('saleUnitPrice', unitSuffix)}
            {values.saleUnitManual && (
              <div className="material-source-label">{t('manualSalePrice')}</div>
            )}
            {strandPrice !== null && (
              <div className="material-price-suggestions">
                <div>
                  <span>
                    {t('saleFromBeads')}: {strandPrice} {unitSuffix}
                  </span>
                  <Button type="link" size="small" onClick={onAdopt}>
                    {t('adopt')}
                  </Button>
                </div>
              </div>
            )}
          </Form.Item>
        )}
        <Form.Item label={t('saleGramPrice')}>
          {amount('saleGramPrice', t('yuanPerGram'))}
        </Form.Item>
        {values.unit === 'STRAND' && (
          <Form.Item label={t('saleChildUnitPrice')}>
            {amount('saleChildUnitPrice', t('yuanPerBead'))}
          </Form.Item>
        )}
      </div>
    </section>
  );
}
