'use client';

import { useState, type ReactNode } from 'react';
import { Popover } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { Sensitive } from '@/components/privacyMode';
import { formatAmount } from '@/lib/format-money';
import type { PricingPreview } from '@/lib/material-pricing/contracts';
import pricingStyles from './materialPricingPage.module.css';
import { MaterialPricingExplanation } from './materialPricingExplanation';

export function MaterialPricingMetric({
  label,
  amount,
  help,
  explanation,
  sensitive = true,
}: {
  label: string;
  amount: string | null | undefined;
  help?: string;
  explanation?: ReactNode;
  sensitive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const values = (
    <>
      <span className={pricingStyles.metricLabel}>
        {label}
        {explanation && <InfoCircleOutlined aria-hidden />}
      </span>
      <strong>{amount == null ? '—' : `¥${formatAmount(amount)}`}</strong>
      {help && <span className={pricingStyles.help}>{help}</span>}
    </>
  );
  const content = explanation ? (
    <Popover
      title={label}
      content={explanation}
      trigger={['hover', 'focus', 'click']}
      placement="top"
      open={open}
      onOpenChange={setOpen}
      destroyOnHidden
      styles={{ root: { maxWidth: 'calc(100vw - 24px)' } }}
    >
      <button
        type="button"
        aria-label={label}
        className={`${pricingStyles.metric} ${pricingStyles.metricTrigger}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        {values}
      </button>
    </Popover>
  ) : (
    <div className={pricingStyles.metric}>{values}</div>
  );
  return sensitive ? <Sensitive>{content}</Sensitive> : content;
}

export function MaterialPricingMetrics({ preview }: { preview: PricingPreview }) {
  const t = useTranslations('materialPricing');
  const purchaseHelp = !preview.recent.count
    ? 'purchaseNoSamples'
    : preview.replacementCost !== null
      ? 'purchaseMarketHelp'
      : 'purchaseAverageHelp';
  return (
    <div className={`${pricingStyles.metrics} ${pricingStyles.overviewMetrics}`}>
      <MaterialPricingMetric
        label={t('rawCost')}
        amount={preview.totals.rawCost}
        explanation={<MaterialPricingExplanation kind="raw" preview={preview} />}
      />
      <MaterialPricingMetric
        label={t('estimatedCost')}
        amount={preview.totals.adjustedCost}
        explanation={<MaterialPricingExplanation kind="loss" preview={preview} />}
      />
      <MaterialPricingMetric
        label={t('suggestedPrice')}
        amount={preview.suggestedPrice}
        help={t('saleHistoryHelp')}
        explanation={<MaterialPricingExplanation kind="sale" preview={preview} />}
      />
      <MaterialPricingMetric
        label={t('suggestedPurchasePrice')}
        amount={preview.replacementCost ?? preview.recent.rawCost}
        help={t(purchaseHelp)}
        explanation={<MaterialPricingExplanation kind="purchase" preview={preview} />}
      />
    </div>
  );
}
