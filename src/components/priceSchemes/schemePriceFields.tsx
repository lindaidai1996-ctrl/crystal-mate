'use client';
import { Alert, Button, InputNumber, Select, Skeleton, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import type { Product } from '@/lib/client-types';
import type { PriceContext, PriceScheme, SchemePricesWrite } from '@/lib/price-schemes/contracts';
import { calculateScheme } from '@/lib/price-schemes/formula';
import { usePrivacyMode } from '../privacyMode';
import css from './priceSchemes.module.css';
export function productSchemeDraft(
  product: Pick<Product, 'schemePrices' | 'schemePricesToken'> | null,
): SchemePricesWrite {
  return {
    expectedToken: product?.schemePricesToken,
    items: (product?.schemePrices ?? []).map((row) => ({
      schemeId: row.schemeId,
      schemeVersion: row.scheme.version,
      mode: row.mode,
      amountCents: row.amountCents,
    })),
  };
}
export function SchemePriceFields({
  value,
  onChange,
  context,
  saved,
  disabled,
}: {
  value?: SchemePricesWrite;
  onChange?: (value: SchemePricesWrite) => void;
  context: PriceContext;
  saved?: Product['schemePrices'];
  disabled?: boolean;
}) {
  const t = useTranslations('priceSchemes');
  const privacy = usePrivacyMode();
  const [schemes, setSchemes] = useState<PriceScheme[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PriceScheme[]>('/api/price-schemes', { signal: controller.signal })
      .then(setSchemes)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!schemes || !onChange) return;
    const items = value?.items ?? [];
    const missing = schemes.filter(
      (scheme) => scheme.common && !items.some((row) => row.schemeId === scheme.id),
    );
    if (missing.length)
      onChange({
        ...value,
        items: [
          ...items,
          ...missing.map((scheme) => ({
            schemeId: scheme.id,
            schemeVersion: scheme.version,
            mode: 'AUTO' as const,
            amountCents: null,
          })),
        ],
      });
  }, [schemes, value, onChange]);
  if (failed)
    return (
      <Alert
        type="error"
        message={t('loadFailed')}
        action={
          <Button
            onClick={() => {
              setFailed(false);
              setRetry(retry + 1);
            }}
          >
            {t('retry')}
          </Button>
        }
      />
    );
  if (!schemes) return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
  const items = value?.items ?? [];
  const change = (next: SchemePricesWrite['items']) => onChange?.({ ...value, items: next });
  const sorted = [...items].sort(
    (a, b) =>
      schemes.findIndex((s) => s.id === a.schemeId) - schemes.findIndex((s) => s.id === b.schemeId),
  );
  return (
    <div className={css.stack}>
      <h3>{t('otherPrices')}</h3>
      {sorted.map((item) => {
        const scheme = schemes.find((row) => row.id === item.schemeId);
        if (!scheme) return null;
        const calculated = calculateScheme(
          scheme.formula,
          scheme.rounding,
          context.values,
          context.applicable,
        );
        const amount = item.mode === 'AUTO' ? calculated.amountCents : item.amountCents;
        const error = item.mode === 'AUTO' ? calculated.error : null;
        const savedPrice = saved?.find((row) => row.schemeId === item.schemeId);
        const previous = savedPrice?.amountCents ?? savedPrice?.previousAmountCents;
        return (
          <div className={css.row} key={item.schemeId}>
            <div className={css.label}>
              <strong>{scheme.name}</strong>
              {item.mode !== 'AUTO' && <span className={css.badge}>{t(item.mode)}</span>}
              {!privacy && (
                <Tooltip title={scheme.formula}>
                  <span className={css.muted}>{t('formulaDetails')}</span>
                </Tooltip>
              )}
              {error && (
                <span className={css.muted} role="status">
                  {t(error)}
                </span>
              )}
              {error && previous != null && (
                <span className={css.muted}>
                  {t('previous', { amount: (previous / 100).toFixed(2) })}
                </span>
              )}
            </div>
            <InputNumber<string>
              aria-label={scheme.name}
              stringMode
              prefix="¥"
              precision={2}
              min="0"
              max="21474836.47"
              style={{ width: '100%' }}
              disabled={disabled}
              value={amount === null ? null : (amount / 100).toFixed(2)}
              placeholder={error ? '—' : undefined}
              onChange={(next) =>
                change(
                  items.map((row) =>
                    row.schemeId === item.schemeId
                      ? {
                          ...row,
                          mode: 'MANUAL',
                          amountCents: next === null ? null : Math.round(Number(next) * 100),
                        }
                      : row,
                  ),
                )
              }
            />
            <div className={css.actions}>
              {item.mode !== 'AUTO' && (
                <Button
                  size="small"
                  disabled={disabled}
                  onClick={() =>
                    change(
                      items.map((row) =>
                        row.schemeId === item.schemeId
                          ? { ...row, mode: 'AUTO', schemeVersion: scheme.version }
                          : row,
                      ),
                    )
                  }
                >
                  {t('restore')}
                </Button>
              )}
              {!scheme.common && (
                <Button
                  size="small"
                  type="text"
                  danger
                  disabled={disabled}
                  onClick={() => change(items.filter((row) => row.schemeId !== item.schemeId))}
                >
                  {t('remove')}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <Select<string>
        aria-label={t('addScheme')}
        placeholder={t('addScheme')}
        value={undefined}
        showSearch
        optionFilterProp="label"
        disabled={disabled}
        options={schemes
          .filter((scheme) => !items.some((row) => row.schemeId === scheme.id))
          .map((scheme) => ({ value: scheme.id, label: scheme.name }))}
        onChange={(id) => {
          const scheme = schemes.find((row) => row.id === id)!;
          change([
            ...items,
            { schemeId: id, schemeVersion: scheme.version, mode: 'AUTO', amountCents: null },
          ]);
        }}
      />
      {!schemes.length && <p className={css.muted}>{t('noSchemes')}</p>}
    </div>
  );
}
