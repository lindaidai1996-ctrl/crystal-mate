'use client';
import { Alert, Button, Input, InputNumber, Select, Switch } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import type { ProductPage } from '@/lib/client-types';
import { calculateScheme, parseFormula, variables } from '@/lib/price-schemes/formula';
import type { PriceContext, SchemeInput } from '@/lib/price-schemes/contracts';
import css from './priceSchemes.module.css';
export function SchemeFormulaEditor({
  value,
  onChange,
}: {
  value: SchemeInput;
  onChange: (value: SchemeInput) => void;
}) {
  const t = useTranslations('priceSchemes');
  const formula = useRef<TextAreaRef>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [productId, setProductId] = useState<string>();
  const [context, setContext] = useState<PriceContext>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      apiFetch<ProductPage>(`/api/products?pageSize=20&q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((page) => {
          setOptions(
            page.items.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` })),
          );
          setFailed(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    // Fetch the variable context independently of the editable formula.
    apiFetch<{ context: PriceContext }>('/api/price-schemes/evaluate', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        productId,
        input: { ...value, name: value.name || 'preview', formula: 'direct' },
      }),
    })
      .then((result) => {
        setContext(result.context);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
    // Variable values depend on the chosen product, not formula keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  let syntax = false;
  try {
    parseFormula(value.formula);
    syntax = true;
  } catch {
    /* shown below */
  }
  const result = context
    ? calculateScheme(value.formula, value.rounding, context.values, context.applicable)
    : null;
  function insert(text: string) {
    const input = formula.current?.resizableTextArea?.textArea;
    const start = input?.selectionStart ?? value.formula.length,
      end = input?.selectionEnd ?? start;
    onChange({
      ...value,
      formula: value.formula.slice(0, start) + text + value.formula.slice(end),
    });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  return (
    <div className={css.stack}>
      <label>
        {t('name')}
        <Input
          value={value.name}
          maxLength={60}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <div className={css.variables}>
        {variables.map((key) => (
          <Button key={key} size="small" onClick={() => insert(` ${key} `)}>
            {t(key)}
          </Button>
        ))}
      </div>
      <p className={css.muted}>{t('variableHelp')}</p>
      <label>
        {t('formula')}
        <Input.TextArea
          ref={formula}
          aria-label={t('formula')}
          value={value.formula}
          maxLength={1000}
          autoSize={{ minRows: 3, maxRows: 8 }}
          onChange={(event) => onChange({ ...value, formula: event.target.value })}
        />
      </label>
      <p className={css.muted}>{t('formulaHelp')}</p>
      {!syntax && <Alert type="warning" message={t('SYNTAX')} />}
      <label>
        {t('rounding')}
        <Select
          value={value.rounding}
          style={{ width: '100%' }}
          onChange={(rounding) => onChange({ ...value, rounding })}
          options={(['CENT', 'YUAN_UP', 'TEN_UP'] as const).map((key) => ({
            value: key,
            label: t(key),
          }))}
        />
      </label>
      <div className={css.heading}>
        <label>
          {t('common')}{' '}
          <Switch checked={value.common} onChange={(common) => onChange({ ...value, common })} />
        </label>
        <label>
          {t('position')}{' '}
          <InputNumber
            min={0}
            max={9999}
            precision={0}
            value={value.position}
            onChange={(position) => onChange({ ...value, position: position ?? 0 })}
          />
        </label>
      </div>
      <p className={css.muted}>{t('commonHelp')}</p>
      <div className={css.preview}>
        <strong>{t('trial')}</strong>
        <Select
          aria-label={t('chooseProduct')}
          placeholder={t('chooseProduct')}
          showSearch
          filterOption={false}
          onSearch={setQuery}
          loading={loading}
          value={productId}
          options={options}
          onChange={(id) => {
            setContext(undefined);
            setProductId(id);
          }}
        />
        {failed && <Alert type="error" message={t('loadFailed')} />}
        {context && (
          <>
            <div className={css.stats}>
              {variables.map((key) => {
                const display = calculateScheme(key, 'CENT', context.values, context.applicable);
                return (
                  <span key={key}>
                    {t(key)}：
                    {display.error
                      ? t(display.error)
                      : `¥${(display.amountCents! / 100).toFixed(2)}`}
                  </span>
                );
              })}
            </div>
            <strong>
              {t('result')}：
              {result?.error
                ? t(result.error)
                : result?.amountCents == null
                  ? '—'
                  : `¥${(result.amountCents / 100).toFixed(2)}`}
            </strong>
          </>
        )}
      </div>
    </div>
  );
}
