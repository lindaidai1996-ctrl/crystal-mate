'use client';

import { Button, Form, Radio } from 'antd';
import { CompactFields } from '@/components/responsive/compactFields';
import { useTranslations } from 'next-intl';
import type { MaterialSaleRule, MaterialUnit, MaterialValues } from '@/lib/client-types';
import {
  lossCompensatedPrice,
  materialBaseValues,
  materialPriceDifference,
  percentageSalePrice,
  saleGramPriceFromUnit,
  saleUnitPriceFromBeads,
} from '@/lib/material-calculations';
import { MaterialAmountInput } from './purchaseFields';
import { MaterialLossRateField } from './materialLossRateField';
import { MaterialSaleProfit } from './materialSaleProfit';
import { usePrivacyMode } from '@/components/privacyMode';

type PriceField = 'saleUnitPrice' | 'saleGramPrice' | 'saleChildUnitPrice';
type BaseField = 'baseSaleUnitPrice' | 'baseSaleGramPrice' | 'baseSaleChildUnitPrice';

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
  const privacyMode = usePrivacyMode();
  const base = materialBaseValues(values);
  const lossRate = values.lossRate ?? null;
  const gram = values.unit === 'GRAM';
  const ruleValueLabel =
    values.saleRule === 'FIXED_AMOUNT'
      ? gram
        ? 'fixedAmountPerGram'
        : 'fixedAmount'
      : 'customPercent';
  const ruleValueSuffix =
    values.saleRule === 'FIXED_AMOUNT' ? (gram ? t('yuanPerGram') : t('yuan')) : '%';
  const strandPrice = saleUnitPriceFromBeads(values);
  const recommendedGramPrice = saleGramPriceFromUnit(values);
  const fields: {
    actual: PriceField;
    base: BaseField;
    cost: 'purchaseUnitPrice' | 'purchaseGramPrice' | 'childUnitPrice';
    unit: MaterialUnit;
    label: string;
    suffix: string;
  }[] = [
    ...(!gram
      ? [
          {
            actual: 'saleUnitPrice' as const,
            base: 'baseSaleUnitPrice' as const,
            cost: 'purchaseUnitPrice' as const,
            unit: values.unit,
            label: t(values.unit === 'STRAND' ? 'strandSalePrice' : 'beadSalePrice'),
            suffix: t(values.unit === 'STRAND' ? 'yuanPerStrand' : 'yuanPerBead'),
          },
        ]
      : []),
    {
      actual: 'saleGramPrice',
      base: 'baseSaleGramPrice',
      cost: 'purchaseGramPrice',
      unit: 'GRAM',
      label: t('saleGramPrice'),
      suffix: t('yuanPerGram'),
    },
    ...(values.unit === 'STRAND'
      ? [
          {
            actual: 'saleChildUnitPrice' as const,
            base: 'baseSaleChildUnitPrice' as const,
            cost: 'childUnitPrice' as const,
            unit: 'BEAD' as const,
            label: t('beadSalePrice'),
            suffix: t('yuanPerBead'),
          },
        ]
      : []),
  ];

  return (
    <section className="editor-block">
      <h2>{t('saleDetails')}</h2>
      {!privacyMode && (
        <>
          <h3 className="material-subheading">{t('basePricing')}</h3>
          <Form.Item label={t('saleRule')} extra={t('basePricingHelp')}>
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
              ).map((rule) => ({
                label: t(`rule_${rule}`),
                value: rule,
              }))}
            />
          </Form.Item>
          {(values.saleRule === 'FIXED_AMOUNT' || values.saleRule === 'CUSTOM_PERCENT') && (
            <Form.Item className="mobile-short-field" label={t(ruleValueLabel)}>
              <MaterialAmountInput
                value={values.saleRuleValue}
                onChange={(value) => onChange('saleRuleValue', value)}
                suffix={ruleValueSuffix}
                label={t(ruleValueLabel)}
              />
            </Form.Item>
          )}
          <CompactFields className="material-field-grid material-three-columns">
            {fields.map((field) => {
              const rounding = percentageSalePrice(values[field.cost], base);
              const label = t('basePriceLabel', { label: field.label });
              return (
                <Form.Item key={field.base} label={label}>
                  <MaterialAmountInput
                    value={base[field.actual]}
                    onChange={(value) => onChange(field.base, value)}
                    suffix={field.suffix}
                    label={label}
                  />
                  {rounding && (
                    <div className="material-source-label">
                      {t(rounding.roundedUp ? 'saleRoundedUp' : 'saleAlreadyWhole', {
                        price: rounding.originalPrice,
                        unit: field.suffix,
                      })}
                    </div>
                  )}
                </Form.Item>
              );
            })}
          </CompactFields>
          <h3 className="material-subheading">{t('lossCompensation')}</h3>
          <MaterialLossRateField
            value={lossRate}
            onChange={(value) => onChange('lossRate', value)}
          />
        </>
      )}
      <div className="material-field-grid material-three-columns">
        {fields.map((field) => {
          const basis = base[field.actual];
          const suggestion = lossCompensatedPrice(basis, lossRate);
          const increase = materialPriceDifference(suggestion, basis);
          const below =
            suggestion !== values[field.actual] &&
            materialPriceDifference(suggestion, values[field.actual]) !== null;
          const label = t('actualPriceLabel', { label: field.label });
          return (
            <div key={field.actual} className="material-pricing-column">
              {!privacyMode && (
                <div className="material-loss-suggestion" role="status" aria-live="polite">
                  <span>{t('lossSuggestedPrice', { label: field.label })}</span>
                  <strong>{suggestion === null ? '—' : `${suggestion} ${field.suffix}`}</strong>
                  {suggestion !== null && increase !== null ? (
                    <>
                      <span>{t('lossIncrease', { amount: increase, unit: field.suffix })}</span>
                      <span>{t('lossFormula', { price: basis!, rate: lossRate ?? '0' })}</span>
                    </>
                  ) : (
                    <span>{t(basis === null ? 'lossPricePending' : 'lossPriceOverflow')}</span>
                  )}
                  <Button
                    size="small"
                    htmlType="button"
                    disabled={suggestion === null || suggestion === values[field.actual]}
                    onClick={() => onChange(field.actual, suggestion)}
                  >
                    {t('adoptActualPrice')}
                  </Button>
                </div>
              )}
              <Form.Item label={label}>
                <MaterialAmountInput
                  value={values[field.actual]}
                  onChange={(value) => onChange(field.actual, value)}
                  suffix={field.suffix}
                  label={label}
                />
                {!privacyMode && below && (
                  <div className="material-loss-warning">{t('belowLossSuggestion')}</div>
                )}
                {field.actual === 'saleUnitPrice' && strandPrice !== null && (
                  <div className="material-price-suggestions">
                    <div>
                      <span>
                        {t('saleFromBeads')}: {strandPrice} {field.suffix}
                      </span>
                      <Button type="link" size="small" htmlType="button" onClick={onAdopt}>
                        {t('adopt')}
                      </Button>
                    </div>
                  </div>
                )}
                {field.actual === 'saleGramPrice' && recommendedGramPrice !== null && (
                  <div className="material-price-suggestions">
                    <div>
                      <span>
                        {t('saleGramFromUnit')}: {recommendedGramPrice} {field.suffix}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        htmlType="button"
                        disabled={recommendedGramPrice === values.saleGramPrice}
                        onClick={() => onChange('saleGramPrice', recommendedGramPrice)}
                      >
                        {t('adopt')}
                      </Button>
                    </div>
                  </div>
                )}
                <MaterialSaleProfit
                  cost={lossCompensatedPrice(values[field.cost], lossRate)}
                  salePrice={values[field.actual]}
                  unit={field.unit}
                  lossAdjusted
                />
              </Form.Item>
            </div>
          );
        })}
      </div>
      {!privacyMode && <p className="material-input-help">{t('actualPriceHelp')}</p>}
    </section>
  );
}
