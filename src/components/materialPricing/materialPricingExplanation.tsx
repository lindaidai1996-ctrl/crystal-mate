import { useTranslations } from 'next-intl';
import type { PricingPreview } from '@/lib/material-pricing/contracts';
import pricingStyles from './materialPricingPage.module.css';

export function MaterialPricingExplanation({
  kind,
  preview,
}: {
  kind: 'raw' | 'loss' | 'sale' | 'purchase';
  preview: PricingPreview;
}) {
  const t = useTranslations('materialPricing');
  const linked = preview.replacementCost !== null;
  const formula =
    kind === 'sale'
      ? t(`metricExplanation.saleFormula_${preview.pricingRule}`)
      : kind === 'purchase'
        ? t(`metricExplanation.${linked ? 'purchaseLinkedFormula' : 'purchaseFormula'}`)
        : t(`metricExplanation.${kind}Formula`);
  const example =
    kind === 'sale'
      ? t(`metricExplanation.saleExample_${preview.pricingRule}`)
      : kind === 'purchase'
        ? t(`metricExplanation.${linked ? 'purchaseLinkedExample' : 'purchaseExample'}`)
        : t(`metricExplanation.${kind}Example`);
  const purchaseStatus = !preview.recent.count
    ? t('purchaseNoSamples')
    : preview.warning
      ? t(preview.warning)
      : t(linked ? 'purchaseMarketHelp' : 'purchaseAverageHelp');
  return (
    <div className={pricingStyles.metricExplanation}>
      <p>{t(`metricExplanation.${kind}Scope`)}</p>
      {kind === 'loss' && <p>{t('metricExplanation.currentLoss', { rate: preview.lossRate })}</p>}
      {kind === 'sale' && (
        <p>
          {t('metricExplanation.currentRule', {
            rule: t(`rule_${preview.pricingRule}`),
            value: preview.pricingValue ?? '—',
            unit:
              preview.pricingRule === 'PERCENT' || preview.pricingRule === 'MARGIN'
                ? '%'
                : t('pricePerGramUnit'),
          })}
        </p>
      )}
      <section>
        <h3>{t('metricExplanation.formula')}</h3>
        <p>{formula}</p>
      </section>
      <section className={pricingStyles.metricExample}>
        <h3>{t('metricExplanation.example')}</h3>
        <p>{example}</p>
      </section>
      <p className={pricingStyles.help}>{t(`metricExplanation.${kind}Note`)}</p>
      {kind === 'purchase' && <p className={pricingStyles.help}>{purchaseStatus}</p>}
    </div>
  );
}
