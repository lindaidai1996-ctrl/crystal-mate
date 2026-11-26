'use client';

import { Button, ConfigProvider } from 'antd';
import { useTranslations } from 'next-intl';
import { Sensitive } from '@/components/privacyMode';
import { centsToAmount } from '@/lib/cabochon-cost';
import { formatAmount } from '@/lib/format-money';
import type { diySaleSummary } from '@/lib/diy-sale-pricing';
import { ProductPricingFields } from '@/components/product-pricing-fields';
import { editProductPricing, type ProductPricingValues } from '@/lib/product-pricing';
import pricingStyles from './diySalePricing.module.css';

type Summary = ReturnType<typeof diySaleSummary>;
type SharedProps = { summary: Summary; currentPrice: number };
const money = (value: string | null) => (value === null ? '—' : `¥${formatAmount(value)}`);

function PricingSummary({ summary, currentPrice }: SharedProps) {
  const t = useTranslations('productSources');
  const next = summary.priceCents;
  return (
    <dl className={pricingStyles.summary}>
      <Sensitive>
        <div>
          <dt>{t('perUnitCost')}</dt>
          <dd>{money(summary.cost)}</dd>
        </div>
      </Sensitive>
      <div>
        <dt>{t('perUnitQuote')}</dt>
        <dd>{summary.quote === null ? t('quoteIncomplete') : money(summary.quote)}</dd>
      </div>
      <div>
        <dt>{t('salePrice')}</dt>
        <dd className={pricingStyles.priceChange}>
          {next !== currentPrice && (
            <span className={pricingStyles.previous}>
              {money(centsToAmount(BigInt(currentPrice)))} →
            </span>
          )}
          <strong>{next === null ? '—' : money(centsToAmount(BigInt(next)))}</strong>
        </dd>
      </div>
      <Sensitive>
        <div>
          <dt>{t('estimatedUnitProfit')}</dt>
          <dd className={summary.profit?.startsWith('-') ? pricingStyles.loss : undefined}>
            {money(summary.profit)}
          </dd>
        </div>
      </Sensitive>
    </dl>
  );
}

export function DiySalePricing({
  summary,
  currentPrice,
  value,
  onChange,
  disabled,
  multipleRuns,
  valid,
}: SharedProps & {
  value: ProductPricingValues;
  onChange: (value: ProductPricingValues) => void;
  disabled: boolean;
  multipleRuns: boolean;
  valid: boolean;
}) {
  const t = useTranslations('productSources');
  const editor = useTranslations('editor');
  return (
    <section className={pricingStyles.panel} aria-label={t('salePricing')}>
      <h3>{t('salePricing')}</h3>
      <PricingSummary summary={summary} currentPrice={currentPrice} />
      {multipleRuns && <p className={pricingStyles.help}>{t('salePricingRecordHelp')}</p>}
      <p className={pricingStyles.help}>{t('salePricingUnitHelp')}</p>
      <div className={pricingStyles.controls}>
        <ConfigProvider componentDisabled={disabled}>
          <ProductPricingFields
            value={value}
            onChange={onChange}
            cost={summary.cost}
            quote={summary.quote}
          />
        </ConfigProvider>
        <Button
          disabled={disabled || !summary.adoptable}
          onClick={() =>
            summary.quote !== null &&
            onChange(editProductPricing(value, summary.cost, { price: summary.quote }))
          }
        >
          {t('useUnitQuote')}
        </Button>
      </div>
      {!valid && (
        <p className={pricingStyles.error} role="alert">
          {editor('pricingInvalid')}
        </p>
      )}
      <p className={pricingStyles.help}>
        {summary.difference === null
          ? t('saleQuoteMissing')
          : summary.difference === '0.00'
            ? t('saleQuoteSame')
            : t(summary.difference.startsWith('-') ? 'saleQuoteLower' : 'saleQuoteHigher', {
                amount: money(summary.difference.replace(/^-/, '')),
              })}
        {summary.quote !== null && !summary.adoptable && ` ${t('saleQuoteTooLarge')}`}
      </p>
    </section>
  );
}

export function DiySalePricingFooter({
  summary,
  currentPrice,
  saving,
  onSave,
  valid,
}: SharedProps & { saving: boolean; onSave: () => void; valid: boolean }) {
  const t = useTranslations('productSources');
  return (
    <div className={pricingStyles.footer}>
      <PricingSummary summary={summary} currentPrice={currentPrice} />
      <Button type="primary" loading={saving} disabled={!valid} onClick={onSave}>
        {t('saveSourceAndPrice')}
      </Button>
    </div>
  );
}
