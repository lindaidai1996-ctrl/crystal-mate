'use client';

import { useState } from 'react';
import { Checkbox, Select, Tag, type SelectProps } from 'antd';
import { useTranslations } from 'next-intl';
import type { MaterialBatch } from '@/lib/client-types';
import { selectablePurchaseBatches } from '@/lib/material-pricing/batch-visibility';

type Props = Omit<SelectProps<string>, 'options' | 'mode' | 'labelInValue'> & {
  batches: MaterialBatch[];
  createLabel?: string;
};

export function PurchaseBatchSelect({ batches, createLabel, value, ...props }: Props) {
  const t = useTranslations('materialBatches');
  const [showPricing, setShowPricing] = useState(false);
  const visible = selectablePurchaseBatches(batches, showPricing, value);
  const hasPricing = batches.some((batch) => batch.purpose === 'PRICING');

  return (
    <div>
      <Select<string>
        showSearch
        optionFilterProp="label"
        style={{ width: '100%' }}
        {...props}
        value={value}
        options={[
          ...visible.map((batch) => ({
            value: batch.id,
            label: batch.name,
            pricing: batch.purpose === 'PRICING',
          })),
          ...(createLabel ? [{ value: '__new__', label: createLabel, pricing: false }] : []),
        ]}
        optionRender={(option) => (
          <span>
            {option.label}
            {option.data.pricing && <Tag>{t('purpose_PRICING')}</Tag>}
          </span>
        )}
        labelRender={({ label, value: selected }) => (
          <span>
            {label ?? selected}
            {batches.find((batch) => batch.id === selected)?.purpose === 'PRICING' && (
              <Tag>{t('purpose_PRICING')}</Tag>
            )}
          </span>
        )}
      />
      {hasPricing && (
        <Checkbox
          style={{ marginTop: 8 }}
          checked={showPricing}
          disabled={props.disabled}
          onChange={(event) => setShowPricing(event.target.checked)}
        >
          {t('showPricingPurchases')}
        </Checkbox>
      )}
    </div>
  );
}
