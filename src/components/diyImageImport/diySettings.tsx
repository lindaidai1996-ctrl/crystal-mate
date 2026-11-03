'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import type { Category } from '@/lib/client-types';
import type { DiyData } from '@/lib/diyImageImport/contracts';
import styles from './diyImport.module.css';

export function DiySettings({
  data,
  disabled,
  onPatch,
}: {
  data: DiyData;
  disabled: boolean;
  onPatch: (patch: Partial<DiyData>) => void;
}) {
  const t = useTranslations('diyImport');
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState(false);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    let active = true;
    apiFetch<Category[]>('/api/categories')
      .then((items) => {
        if (active) setCategories(items);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  async function generateCode() {
    setGenerating(true);
    setError(false);
    try {
      const result = await apiFetch<{ code: string; reservationToken: string }>(
        '/api/products/code',
        {
          method: 'POST',
          body: JSON.stringify({ categoryId: data.categoryId }),
        },
      );
      onPatch({ code: result.code, codeReservationToken: result.reservationToken });
    } catch {
      setError(true);
    } finally {
      setGenerating(false);
    }
  }
  return (
    <section className={styles.surface}>
      {error && (
        <Alert showIcon type="error" message={t('settingsError')} className={styles.notice} />
      )}
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>{t('productName')}</span>
          <Input
            maxLength={120}
            value={data.name}
            disabled={disabled || !!data.targetProductId}
            onChange={(event) => onPatch({ name: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>{t('category')}</span>
          <Select
            value={data.categoryId || undefined}
            disabled={disabled || generating || !!data.targetProductId}
            options={categories
              .filter((category) => category.name !== '蛋面')
              .map((category) => ({ value: category.id, label: category.name }))}
            onChange={(categoryId) =>
              onPatch({ categoryId, code: '', codeReservationToken: undefined })
            }
          />
        </label>
        <label className={styles.field}>
          <span>{t('productCode')}</span>
          <div className={styles.row}>
            <Input value={data.code} readOnly style={{ flex: 1, minWidth: 70 }} />
            {!data.targetProductId && (
              <Button
                loading={generating}
                disabled={disabled || !data.categoryId}
                onClick={() => void generateCode()}
              >
                {t('generateCode')}
              </Button>
            )}
          </div>
        </label>
        <label className={styles.field}>
          <span>{t('productionQuantity')}</span>
          <InputNumber
            min={1}
            max={2147483647}
            precision={0}
            value={data.quantity}
            disabled={disabled}
            onChange={(quantity) => onPatch({ quantity: quantity ?? 1 })}
          />
        </label>
        <label className={styles.field}>
          <span>{t('salePrice')}</span>
          <InputNumber<string>
            stringMode
            min="0"
            max="21474836.47"
            precision={2}
            value={data.salePrice || null}
            disabled={disabled || !!data.targetProductId}
            onChange={(value) => onPatch({ salePrice: value ?? '' })}
          />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>{t('hint')}</span>
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 3 }}
            maxLength={2000}
            value={data.hint}
            disabled={disabled}
            placeholder={t('hintPlaceholder')}
            onChange={(event) => onPatch({ hint: event.target.value })}
          />
        </label>
      </div>
      <details style={{ marginTop: 16 }}>
        <summary>{t('extraSettings')}</summary>
        <p className={styles.muted}>{t('silverHint')}</p>
        <div className={styles.fields}>
          {(['weightGrams', 'costGramPrice', 'quoteGramPrice'] as const).map((field) => (
            <label className={styles.field} key={field}>
              <span>{t(field)}</span>
              <InputNumber<string>
                stringMode
                min="0"
                max="9999999999.99"
                precision={2}
                disabled={disabled}
                value={data.silverCost[field] || null}
                onChange={(value) =>
                  onPatch({
                    silverCost: { ...data.silverCost, [field]: value ?? '' },
                  })
                }
              />
            </label>
          ))}
          <label className={`${styles.field} ${styles.wide}`}>
            <span>{t('notes')}</span>
            <Input.TextArea
              maxLength={10000}
              autoSize={{ minRows: 2, maxRows: 5 }}
              value={data.notes}
              disabled={disabled}
              onChange={(event) => onPatch({ notes: event.target.value })}
            />
          </label>
        </div>
        <p className={styles.muted}>{t('extraCosts')}</p>
        {data.extraCosts.map((cost, index) => (
          <div className={styles.extra} key={index}>
            <Input
              aria-label={t('feeName')}
              placeholder={t('feeName')}
              maxLength={60}
              disabled={disabled}
              value={cost.name}
              onChange={(event) =>
                onPatch({
                  extraCosts: data.extraCosts.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                })
              }
            />
            <InputNumber<string>
              aria-label={t('feeAmount')}
              stringMode
              min="0"
              max="9999999999.99"
              precision={2}
              disabled={disabled}
              value={cost.amount || null}
              onChange={(value) =>
                onPatch({
                  extraCosts: data.extraCosts.map((item, i) =>
                    i === index ? { ...item, amount: value ?? '' } : item,
                  ),
                })
              }
            />
            <Button
              icon={<DeleteOutlined />}
              aria-label={t('deleteFee')}
              disabled={disabled}
              onClick={() => onPatch({ extraCosts: data.extraCosts.filter((_, i) => i !== index) })}
            />
          </div>
        ))}
        <Button
          style={{ marginTop: 12 }}
          icon={<PlusOutlined />}
          disabled={disabled || data.extraCosts.length >= 50}
          onClick={() =>
            onPatch({
              extraCosts: [...data.extraCosts, { name: '', amount: '', quoteAmount: null }],
            })
          }
        >
          {t('addFee')}
        </Button>
      </details>
    </section>
  );
}
