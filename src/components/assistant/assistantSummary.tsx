'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AssistantBrowserResults } from '@/lib/ai-assistant/result-view';
import type { PurchaseTotals } from '@/lib/ai-assistant/purchase-contracts';
import assistantStyles from './assistantPage.module.css';

export function AssistantSummary({
  result,
  privacy,
  grouped,
}: {
  result: AssistantBrowserResults;
  privacy: boolean;
  grouped: boolean;
}) {
  const t = useTranslations('assistant');
  const totals = (value: PurchaseTotals) => (
    <>
      <p>
        {t('totalCounts', {
          purchases: value.purchaseEntryCount,
          catalogs: value.catalogItemCount,
        })}
      </p>
      <ul>
        {value.quantities.map((quantity) => (
          <li key={quantity.unit}>
            {t('purchasedQuantity')}: {quantity.knownQuantity} {t(`units.${quantity.unit}`)} ·{' '}
            {t('unknownQuantityRows', { count: quantity.unknownQuantityEntryCount })}
          </li>
        ))}
        {!privacy &&
          value.amounts.map((amount, index) => (
            <li key={index}>
              {t('knownAmount')}: {amount.currency ?? t('unknownCurrency')} {amount.knownAmount} ·{' '}
              {t('unknownAmountRows', { count: amount.unknownAmountEntryCount })}
              {amount.businessDefaultCurrencyEntryCount > 0 && (
                <small>
                  {' '}
                  · {t('defaultCurrency', { count: amount.businessDefaultCurrencyEntryCount })}
                </small>
              )}
            </li>
          ))}
      </ul>
    </>
  );
  return (
    <section className={assistantStyles.summary} aria-label={t('fullSummary')}>
      <strong>{t('fullSummary')}</strong>
      <p className={assistantStyles.muted}>{t('summaryBasis')}</p>
      {result.summary && (
        <>
          {totals(result.summary.totals)}
          <details open={grouped || undefined}>
            <summary>
              {t('byDistributor')} ({result.summary.byDistributor.length})
            </summary>
            {result.summary.byDistributor.map((group) => (
              <article key={group.distributor.id}>
                <Link href={`/admin/distributors/${group.distributor.id}`}>
                  {privacy ? t('privateText') : group.distributor.name}
                </Link>
                {totals(group.totals)}
              </article>
            ))}
          </details>
        </>
      )}
      {result.stock && (
        <>
          <p>{t(result.stockMode === 'purchase_remaining' ? 'sourceRemaining' : 'stockSummary')}</p>
          <ul>
            {result.stock.quantities.map((quantity) => (
              <li key={quantity.unit}>
                {quantity.knownStock} {t(`units.${quantity.unit}`)} ·{' '}
                {t('unknownStockObjects', { count: quantity.unknownStockObjectCount })} ·{' '}
                {t('unknownBatches', { count: quantity.unknownStockBatchCount })}
              </li>
            ))}
          </ul>
        </>
      )}
      {privacy && <p className={assistantStyles.muted}>{t('privacyResults')}</p>}
    </section>
  );
}
