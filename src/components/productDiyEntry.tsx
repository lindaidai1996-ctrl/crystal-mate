'use client';

import { ArrowRightOutlined, ToolOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { Product } from '@/lib/client-types';
import { formatCurrency } from '@/lib/format-money';
import diyStyles from './productDiyEntry.module.css';

export function ProductDiyEntry({
  product,
  onOpen,
}: {
  product: Product;
  onOpen: (product: Product) => void;
}) {
  const t = useTranslations('productSources');
  const locale = useLocale();
  if (product.origin !== 'DIY') return null;
  const latest = product.diyRuns[0];

  return (
    <button
      type="button"
      className={diyStyles.entry}
      aria-label={t('openDiyFor', { name: product.name })}
      onClick={() => onOpen(product)}
    >
      <span className={diyStyles.heading}>
        <ToolOutlined />
        <span>{t('diyConfiguration')}</span>
        <ArrowRightOutlined className={diyStyles.arrow} />
      </span>
      <span className={diyStyles.summary}>
        {latest ? (
          <>
            <span>
              {t('diyLineCount', {
                count:
                  (latest.pricingLines?.length ?? 0) +
                  latest.materialLines.length +
                  latest.cabochonLines.length +
                  (Number(latest.silverCost?.weightGrams ?? 0) > 0 ? 1 : 0),
              })}
            </span>
            <span className={latest.perUnitQuote === null ? diyStyles.incomplete : undefined}>
              {latest.perUnitQuote === null
                ? t('quoteIncomplete')
                : t('diyQuoteSummary', {
                    amount: formatCurrency(Number(latest.perUnitQuote), locale),
                  })}
            </span>
          </>
        ) : (
          <span>{t('diyNotConfigured')}</span>
        )}
        <span>
          {t('diySaleSummary', { amount: formatCurrency(product.priceCents / 100, locale) })}
        </span>
      </span>
      {product.diyRuns.length > 1 && (
        <span className={diyStyles.history}>
          {t('diyLatestRecord', { count: product.diyRuns.length })}
        </span>
      )}
    </button>
  );
}
