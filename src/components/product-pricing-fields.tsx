'use client';

import { InputNumber, Radio } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import {
  editProductPricing,
  diyQuotePricing,
  productSaleRules,
  recalculateProductPricing,
  type ProductPricingValues,
} from '@/lib/product-pricing';

export function ProductPricingFields({
  value,
  onChange,
  cost,
  quote,
}: {
  value?: ProductPricingValues;
  onChange?: (value: ProductPricingValues) => void;
  cost: string | null;
  quote?: string | null;
}) {
  const t = useTranslations('editor');
  const automaticMarkup = useRef<boolean | null>(null);
  useEffect(() => {
    if (!value) return;
    if (quote === undefined) automaticMarkup.current = null;
    else if (automaticMarkup.current === null) {
      const defaultPricing = diyQuotePricing(cost, quote);
      automaticMarkup.current =
        value.saleRule === 'FIXED_AMOUNT' &&
        !value.saleManual &&
        (value.saleRuleValue === null || value.saleRuleValue === defaultPricing.saleRuleValue);
    }
    const next =
      quote !== undefined && automaticMarkup.current
        ? diyQuotePricing(cost, quote)
        : recalculateProductPricing(value, cost);
    if (
      next.price !== value.price ||
      next.saleRuleValue !== value.saleRuleValue ||
      next.saleRule !== value.saleRule ||
      next.saleManual !== value.saleManual
    )
      onChange?.(next);
  }, [cost, quote, onChange, value]);

  if (!value) return null;
  const custom = value.saleRule === 'FIXED_AMOUNT' || value.saleRule === 'CUSTOM_PERCENT';
  return (
    <div className="product-pricing-fields">
      <div className="source-field">
        <span>{t('saleRule')}</span>
        <Radio.Group
          className="material-rule-options"
          aria-label={t('saleRule')}
          value={value.saleRule}
          onChange={(event) => {
            automaticMarkup.current = false;
            onChange?.(editProductPricing(value, cost, { saleRule: event.target.value }));
          }}
        >
          {productSaleRules.map((rule) => (
            <Radio
              key={rule}
              value={rule}
              onClick={() => {
                if (rule === value.saleRule && value.saleManual) {
                  automaticMarkup.current = false;
                  onChange?.(editProductPricing(value, cost, { saleRule: rule }));
                }
              }}
            >
              {t(`rule_${rule}`)}
            </Radio>
          ))}
        </Radio.Group>
      </div>
      <div className="product-source-grid">
        {custom && (
          <label className="source-field">
            <span>{t(value.saleRule === 'FIXED_AMOUNT' ? 'fixedAmount' : 'customPercent')}</span>
            <InputNumber<string>
              stringMode
              min={value.saleRule === 'FIXED_AMOUNT' ? '-9999999999.99' : '0'}
              max="9999999999.99"
              precision={2}
              step="0.01"
              style={{ width: '100%' }}
              value={value.saleRuleValue}
              suffix={value.saleRule === 'FIXED_AMOUNT' ? '¥' : '%'}
              aria-label={t(value.saleRule === 'FIXED_AMOUNT' ? 'fixedAmount' : 'customPercent')}
              onChange={(saleRuleValue) => {
                automaticMarkup.current = false;
                onChange?.(editProductPricing(value, cost, { saleRuleValue }));
              }}
            />
          </label>
        )}
        <label className="source-field">
          <span>{t('price')}</span>
          <InputNumber<string>
            stringMode
            min="0"
            max="21474836.47"
            precision={2}
            step="0.01"
            style={{ width: '100%' }}
            value={value.price}
            suffix="¥"
            aria-label={t('price')}
            onChange={(price) => {
              automaticMarkup.current = false;
              onChange?.(editProductPricing(value, cost, { price }));
            }}
          />
        </label>
      </div>
      <p className="product-pricing-help">
        {t(
          value.saleManual
            ? 'manualPriceHelp'
            : quote !== undefined
              ? 'diyAutoPriceHelp'
              : 'autoPriceHelp',
        )}
      </p>
    </div>
  );
}
