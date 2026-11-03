'use client';

import { Button, Form, Radio } from 'antd';
import { useTranslations } from 'next-intl';
import type { MaterialSaleRule, MaterialValues } from '@/lib/client-types';
import {
  percentageSalePrice,
  saleGramPriceFromUnit,
  saleUnitPriceFromBeads,
} from '@/lib/material-calculations';
import { MaterialAmountInput } from './purchaseFields';
import { MaterialSaleProfit } from './materialSaleProfit';

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
  const recommendedGramPrice = saleGramPriceFromUnit(values);
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
  const roundingNote = (
    cost: string | null,
    manual: boolean,
    price: string | null,
    suffix: string,
  ) => {
    if (manual) return null;
    const result = percentageSalePrice(cost, values);
    if (result === null || result.price !== price) return null;
    return (
      <div className="material-source-label">
        {t(result.roundedUp ? 'saleRoundedUp' : 'saleAlreadyWhole', {
          price: result.originalPrice,
          unit: suffix,
        })}
      </div>
    );
  };

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
              'PERCENT_30',
              'PERCENT_50',
              'PERCENT_60',
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
            {roundingNote(
              values.purchaseUnitPrice,
              values.saleUnitManual,
              values.saleUnitPrice,
              unitSuffix,
            )}
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
            <MaterialSaleProfit
              cost={values.purchaseUnitPrice}
              salePrice={values.saleUnitPrice}
              unit={values.unit}
            />
          </Form.Item>
        )}
        <Form.Item label={t('saleGramPrice')}>
          {amount('saleGramPrice', t('yuanPerGram'))}
          {roundingNote(
            values.purchaseGramPrice,
            values.saleGramManual,
            values.saleGramPrice,
            t('yuanPerGram'),
          )}
          {recommendedGramPrice !== null && (
            <div className="material-price-suggestions">
              <div>
                <span>
                  {t('saleGramFromUnit')}: {recommendedGramPrice} {t('yuanPerGram')}
                </span>
                <Button
                  type="link"
                  size="small"
                  disabled={recommendedGramPrice === values.saleGramPrice}
                  onClick={() => onChange('saleGramPrice', recommendedGramPrice)}
                >
                  {t('adopt')}
                </Button>
              </div>
            </div>
          )}
          <MaterialSaleProfit
            cost={values.purchaseGramPrice}
            salePrice={values.saleGramPrice}
            unit="GRAM"
          />
        </Form.Item>
        {values.unit === 'STRAND' && (
          <Form.Item label={t('saleChildUnitPrice')}>
            {amount('saleChildUnitPrice', t('yuanPerBead'))}
            {roundingNote(
              values.childUnitPrice,
              values.saleChildManual,
              values.saleChildUnitPrice,
              t('yuanPerBead'),
            )}
            <MaterialSaleProfit
              cost={values.childUnitPrice}
              salePrice={values.saleChildUnitPrice}
              unit="BEAD"
            />
          </Form.Item>
        )}
      </div>
    </section>
  );
}
