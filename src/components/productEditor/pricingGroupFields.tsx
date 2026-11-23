'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, App, Button, Empty, InputNumber, Select } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/client-api';
import { Sensitive } from '@/components/privacyMode';
import { diyQuoteLineTotal } from '@/lib/product-diy-cost';
import type { PricingLineInput, PricingOption } from '@/lib/material-pricing/contracts';
import pricingStyles from './pricingGroupFields.module.css';

function snapshotName(line: PricingLineInput) {
  try {
    const payload = line.costBasisToken.split('.')[0].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)),
      ),
    ).name as string;
  } catch {
    return line.groupId;
  }
}
export function PricingGroupFields({
  value,
  onChange,
  disabled = false,
}: {
  value: PricingLineInput[];
  onChange: (lines: PricingLineInput[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('materialPricing');
  const { message } = App.useApp();
  const [options, setOptions] = useState<PricingOption[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>();
  const [revision, setRevision] = useState(0);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ items: PricingOption[] }>('/api/material-pricing-groups/options', {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setOptions(result.items);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  const applyOption = (option: PricingOption, line?: PricingLineInput): PricingLineInput => ({
    ...(line?.id ? { id: line.id } : {}),
    groupId: option.id,
    publicationId: option.publicationId,
    costBasisToken: option.costBasisToken,
    quantity: line?.quantity ?? '1',
    unitCost: option.unitCost,
    quoteUnitPrice: option.saleGramPrice,
  });
  async function updatePrices(index: number) {
    const original = latest.current.value[index];
    if (!original) return;
    try {
      const result = await apiFetch<{ items: PricingOption[] }>(
        '/api/material-pricing-groups/options',
      );
      setOptions(result.items);
      const option = result.items.find((item) => item.id === original.groupId);
      if (!option) {
        message.warning(t('unavailable'));
        return;
      }
      // A late refresh must not overwrite subsequent edits or a removed/replaced row.
      const current = latest.current;
      if (current.value[index] !== original) return;
      current.onChange(
        current.value.map((line, at) => (at === index ? applyOption(option, line) : line)),
      );
    } catch {
      message.error(t('loadError'));
    }
  }
  return (
    <section className={pricingStyles.section}>
      <div className={pricingStyles.heading}>
        <strong>{t('diyTitle')}</strong>
        <Link href="/admin/material-pricing">{t('manage')}</Link>
      </div>
      <p className={pricingStyles.help}>{t('diyHelp')}</p>
      {error && (
        <Alert
          type="error"
          showIcon
          message={t('loadError')}
          action={
            <Button
              onClick={() => {
                setLoading(true);
                setRevision((value) => value + 1);
              }}
            >
              {t('refresh')}
            </Button>
          }
        />
      )}
      {value.map((line, index) => {
        const change = (patch: Partial<PricingLineInput>) =>
          onChange(value.map((item, at) => (at === index ? { ...item, ...patch } : item)));
        return (
          <div className={pricingStyles.line} key={line.id ?? index}>
            <div className={pricingStyles.lineTitle}>
              <strong>{snapshotName(line)}</strong>
              <Button
                danger
                type="text"
                aria-label={t('remove')}
                icon={<DeleteOutlined />}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, at) => at !== index))}
              />
            </div>
            <div className={pricingStyles.fields}>
              <label>
                <span>{t('usageWeight')}</span>
                <InputNumber<string>
                  stringMode
                  min="0.01"
                  max="9999999999.99"
                  precision={2}
                  value={line.quantity || null}
                  disabled={disabled}
                  onChange={(quantity) => change({ quantity: quantity ?? '' })}
                />
              </label>
              <Sensitive>
                <label>
                  <span>{t('estimatedCost')}</span>
                  <InputNumber<string>
                    stringMode
                    min="0"
                    max="9999999999.99"
                    precision={2}
                    value={line.unitCost || null}
                    disabled={disabled}
                    onChange={(unitCost) => change({ unitCost: unitCost ?? '' })}
                  />
                </label>
              </Sensitive>
              <label>
                <span>{t('saleGramPrice')}</span>
                <InputNumber<string>
                  stringMode
                  min="0"
                  max="9999999999.99"
                  precision={2}
                  value={line.quoteUnitPrice || null}
                  disabled={disabled}
                  onChange={(quoteUnitPrice) => change({ quoteUnitPrice: quoteUnitPrice ?? '' })}
                />
              </label>
              <Button
                icon={<ReloadOutlined />}
                disabled={disabled}
                onClick={() => void updatePrices(index)}
              >
                {t('updatePrices')}
              </Button>
            </div>
            <div className={pricingStyles.totals}>
              <Sensitive>
                <span>
                  {t('costSubtotal')}: ¥{diyQuoteLineTotal(line.quantity, line.unitCost) ?? '—'}
                </span>
              </Sensitive>
              <span>
                {t('quoteSubtotal')}: ¥
                {diyQuoteLineTotal(line.quantity, line.quoteUnitPrice) ?? '—'}
              </span>
            </div>
          </div>
        );
      })}
      {!error && !loading && !options.length && !value.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noActiveGroups')} />
      )}
      <div className={pricingStyles.add}>
        <Select
          showSearch
          optionFilterProp="label"
          aria-label={t('chooseGroup')}
          placeholder={t('chooseGroup')}
          loading={loading}
          disabled={disabled}
          value={selected}
          onChange={setSelected}
          options={options.map((item) => ({ value: item.id, label: item.name }))}
        />
        <Button
          icon={<PlusOutlined />}
          disabled={disabled || !selected || value.length >= 50}
          onClick={() => {
            const option = options.find((item) => item.id === selected);
            if (option) {
              onChange([...value, applyOption(option)]);
              setSelected(undefined);
            }
          }}
        >
          {t('add')}
        </Button>
      </div>
    </section>
  );
}
