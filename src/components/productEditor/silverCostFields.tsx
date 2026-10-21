'use client';

import { Alert, App, Button, Collapse, InputNumber, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { silverCostTotals, type SilverCost, type SilverPricing } from '@/lib/silver-cost';
import { silverPricingSchema } from '@/lib/validation';

export function SilverCostFields({
  value,
  onChange,
}: {
  value: SilverCost | null;
  onChange: (value: SilverCost) => void;
}) {
  const t = useTranslations('productSources');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [loadError, setLoadError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const latest = useRef({ value, onChange });
  const needsInitialization = value === null;

  useEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);

  useEffect(() => {
    if (!needsInitialization) return;
    let active = true;
    apiFetch<SilverPricing>('/api/settings/silver-pricing')
      .then((pricing) => {
        if (!active || latest.current.value !== null) return;
        setLoadError(false);
        // Use the current callback so edits to other DIY fields survive the request.
        latest.current.onChange({ weightGrams: '0', ...pricing });
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [needsInitialization, loadRevision]);

  async function applyDefaults() {
    if (!value || saving) return;
    const pricing = silverPricingSchema.safeParse({
      costGramPrice: value.costGramPrice,
      quoteGramPrice: value.quoteGramPrice,
    });
    if (!pricing.success) return;
    setSaving(true);
    try {
      await apiFetch<SilverPricing>('/api/settings/silver-pricing', {
        method: 'PUT',
        body: JSON.stringify(pricing.data),
      });
      message.success(t('silverDefaultsSaved'));
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSaving(false);
    }
  }

  const totals = value ? silverCostTotals(value) : null;
  const canApply =
    value !== null &&
    silverPricingSchema.safeParse({
      costGramPrice: value.costGramPrice,
      quoteGramPrice: value.quoteGramPrice,
    }).success;

  return (
    <Collapse
      className="product-silver-cost"
      ghost
      expandIconPosition="end"
      defaultActiveKey={['silver']}
      items={[
        {
          key: 'silver',
          label: <strong>{t('silverTitle')}</strong>,
          styles: {
            header: { padding: 0, width: 'fit-content' },
            body: { padding: '10px 0 0' },
          },
          children: (
            <div className="product-silver-details">
              {value === null ? (
                loadError ? (
                  <Alert
                    type="error"
                    showIcon
                    message={t('silverDefaultsLoadError')}
                    action={
                      <Button
                        size="small"
                        onClick={() => {
                          setLoadError(false);
                          setLoadRevision((revision) => revision + 1);
                        }}
                      >
                        {t('silverDefaultsRetry')}
                      </Button>
                    }
                  />
                ) : (
                  <div className="product-silver-loading">
                    <Spin size="small" />
                    <span>{t('silverDefaultsLoading')}</span>
                  </div>
                )
              ) : (
                <>
                  <div className="product-silver-inputs">
                    {(
                      [
                        ['weightGrams', 'silverWeight'],
                        ['costGramPrice', 'silverCostGramPrice'],
                        ['quoteGramPrice', 'silverQuoteGramPrice'],
                      ] as const
                    ).map(([field, label]) => (
                      <label className="source-field" key={field}>
                        <span>{t(label)}</span>
                        <InputNumber<string>
                          stringMode
                          min="0"
                          max="9999999999.99"
                          precision={2}
                          value={value[field] === '' ? null : value[field]}
                          onChange={(amount) => onChange({ ...value, [field]: amount ?? '' })}
                        />
                      </label>
                    ))}
                    <Button
                      loading={saving}
                      disabled={!canApply}
                      onClick={() => void applyDefaults()}
                    >
                      {t('silverApplyAll')}
                    </Button>
                  </div>
                  <span className="material-input-help">{t('silverDefaultsHelp')}</span>
                  <div className="source-line-totals">
                    <span className="source-line-total">
                      {t('lineCost')}: {totals ? `¥${totals.cost}` : '—'}
                    </span>
                    <span className="source-line-total source-line-quote">
                      {t('quoteLineTotal')}: {totals ? `¥${totals.quote}` : t('quoteMissing')}
                    </span>
                  </div>
                </>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
