'use client';

import { Button, ConfigProvider, Form, Radio, Tooltip } from 'antd';
import { CompactFields } from '@/components/responsive/compactFields';
import { useTranslations } from 'next-intl';
import type { MaterialSaleRule, MaterialUnit, MaterialValues } from '@/lib/client-types';
import {
  baseSalePricesFromGram,
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
  const { componentDisabled } = ConfigProvider.useConfig();
  const base = materialBaseValues(values);
  const gramSuggestions = baseSalePricesFromGram({
    ...base,
    baseSaleGramPrice: base.saleGramPrice,
  });
  const lossRate = values.lossRate ?? null;
  const hasLoss = lossRate !== null && Number(lossRate) > 0;
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
              const basis = base[field.actual];
              const suggestion = lossCompensatedPrice(basis, lossRate);
              const increase = materialPriceDifference(suggestion, basis);
              const rounding = percentageSalePrice(values[field.cost], base);
              const label = t('basePriceLabel', { label: field.label });
              const fromGram =
                field.base === 'baseSaleUnitPrice'
                  ? gramSuggestions.unitPrice
                  : gramSuggestions.childPrice;
              const child = field.base === 'baseSaleChildUnitPrice';
              return (
                <Form.Item key={field.base} label={label}>
                  <MaterialAmountInput
                    value={base[field.actual]}
                    onChange={(value) => onChange(field.base, value)}
                    suffix={field.suffix}
                    label={label}
                  />
                  {hasLoss && (
                    <Tooltip
                      title={
                        suggestion !== null && increase !== null ? (
                          <>
                            <div>{t('lossIncrease', { amount: increase, unit: field.suffix })}</div>
                            <div>{t('lossFormula', { price: basis!, rate: lossRate! })}</div>
                          </>
                        ) : (
                          t(basis === null ? 'lossPricePending' : 'lossPriceOverflow')
                        )
                      }
                    >
                      <div className="material-loss-suggestion">
                        {t('lossSuggestionCompact')}{' '}
                        <strong>
                          {suggestion === null ? '—' : `${suggestion} ${field.suffix}`}
                        </strong>
                      </div>
                    </Tooltip>
                  )}
                  {rounding && (
                    <div className="material-source-label">
                      {t(rounding.roundedUp ? 'saleRoundedUp' : 'saleAlreadyWhole', {
                        price: rounding.originalPrice,
                        unit: field.suffix,
                      })}
                    </div>
                  )}
                  {field.base !== 'baseSaleGramPrice' && (
                    <div className="material-price-suggestions" aria-live="polite">
                      <div>
                        <span>
                          {fromGram === null
                            ? t(child ? 'baseBeadFromGramPending' : 'baseUnitFromGramPending')
                            : t(
                                child && gramSuggestions.childUsesAverageWeight
                                  ? 'basePriceFromGramAverage'
                                  : 'basePriceFromGram',
                                { price: fromGram, unit: field.suffix },
                              )}
                        </span>
                        <Button
                          type="link"
                          size="small"
                          htmlType="button"
                          disabled={
                            componentDisabled ||
                            fromGram === null ||
                            fromGram === base[field.actual]
                          }
                          onClick={() => onChange(field.base, fromGram)}
                        >
                          {t('useBasePrice')}
                        </Button>
                      </div>
                    </div>
                  )}
                </Form.Item>
              );
            })}
          </CompactFields>
          <div className="material-loss-toolbar">
            <MaterialLossRateField
              value={lossRate}
              onChange={(value) => onChange('lossRate', value)}
              compact
            />
          </div>
        </>
      )}
      <h3 className="material-subheading">{t('finalSalePrices')}</h3>
      <p className="material-input-help">
        {t(privacyMode ? 'salePriceManualHelp' : 'salePriceHelp')}
      </p>
      <div className="material-field-grid material-three-columns">
        {fields.map((field) => {
          const suggestion = lossCompensatedPrice(base[field.actual], lossRate);
          const below =
            suggestion !== values[field.actual] &&
            materialPriceDifference(suggestion, values[field.actual]) !== null;
          const label = t(
            field.actual === 'saleGramPrice'
              ? 'sellingGramPrice'
              : field.unit === 'STRAND'
                ? 'sellingStrandPrice'
                : 'sellingBeadPrice',
          );
          return (
            <div key={field.actual} className="material-pricing-column">
              <Form.Item label={label}>
                <MaterialAmountInput
                  value={values[field.actual]}
                  onChange={(value) => onChange(field.actual, value)}
                  suffix={field.suffix}
                  label={label}
                />
                {!privacyMode && hasLoss && below && (
                  <div className="material-loss-warning">{t('belowLossSuggestion')}</div>
                )}
                {field.actual === 'saleUnitPrice' && strandPrice !== null && (
                  <div className="material-price-suggestions">
                    <div>
                      <span>
                        {t('saleFromBeads')}: {strandPrice} {field.suffix}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        htmlType="button"
                        disabled={componentDisabled || strandPrice === values.saleUnitPrice}
                        onClick={onAdopt}
                      >
                        {t('useSuggestedSalePrice')}
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
                        disabled={
                          componentDisabled || recommendedGramPrice === values.saleGramPrice
                        }
                        onClick={() => onChange('saleGramPrice', recommendedGramPrice)}
                      >
                        {t('useSuggestedSalePrice')}
                      </Button>
                    </div>
                  </div>
                )}
                <MaterialSaleProfit
                  cost={lossCompensatedPrice(values[field.cost], lossRate)}
                  salePrice={values[field.actual]}
                  unit={field.unit}
                  lossAdjusted={hasLoss}
                />
              </Form.Item>
            </div>
          );
        })}
      </div>
    </section>
  );
}
