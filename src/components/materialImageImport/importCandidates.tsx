'use client';

import { Checkbox, Empty, Tag } from 'antd';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { calculatePurchase } from '@/lib/material-purchase';
import { importMaterialDraft, importQuantity } from '@/lib/materialImageImport/materialDraft';
import type { ImageImport, ImportItemData } from '@/lib/materialImageImport/contracts';
import type { ImportValidation } from '@/lib/materialImageImport/importValidation';
import { CropPreview } from './importImageCanvas';
import importStyles from './materialImageImport.module.css';

export function ImportCandidates({
  job,
  activeId,
  disabled,
  onSelect,
  onChange,
  validation,
}: {
  job: ImageImport;
  activeId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<ImportItemData>) => void;
  validation?: ImportValidation | null;
}) {
  const t = useTranslations('imageImport');
  const materials = useTranslations('materials');
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !active) return;
    const bounds = list.getBoundingClientRect();
    const itemBounds = active.getBoundingClientRect();
    if (itemBounds.bottom > bounds.bottom) list.scrollTop += itemBounds.bottom - bounds.bottom + 12;
    else if (itemBounds.top < bounds.top) list.scrollTop += itemBounds.top - bounds.top - 12;
  }, [activeId]);
  return (
    <section ref={listRef} className={importStyles.candidates} aria-label={t('candidatesTitle')}>
      <div className={importStyles.candidatesHeading}>
        <h2>{t('candidatesTitle')}</h2>
        <span>{job.items.length}</span>
      </div>
      <p className={importStyles.hint}>{t('candidatesHelp')}</p>
      <div className={importStyles.candidateGrid}>
        {job.items.map((item, index) => {
          const material = importMaterialDraft(item.data);
          const values = calculatePurchase(
            material.values,
            material.purchase,
            importQuantity(item.data),
          ).values;
          const gram = values.unit === 'GRAM';
          const purchasePrice = gram ? values.purchaseGramPrice : values.purchaseUnitPrice;
          const salePrice = gram ? values.saleGramPrice : values.saleUnitPrice;
          const currentPrice = item.data.priceKind === 'SALE' ? salePrice : purchasePrice;
          const priceAdjusted =
            item.data.price !== null &&
            currentPrice !== null &&
            Number(item.data.price) !== Number(currentPrice);
          const unit = materials(values.unit);
          const issues = validation?.items.find((row) => row.id === item.id)?.issues ?? [];
          return (
            <article
              key={item.id}
              className={`${importStyles.candidate} ${activeId === item.id ? importStyles.activeCandidate : ''}`}
            >
              <Checkbox
                aria-label={t('includeNumber', { number: index + 1 })}
                disabled={disabled || !!job.archivedAt || !!item.entryId}
                checked={item.data.selected}
                onChange={(event) => onChange(item.id, { selected: event.target.checked })}
              />
              <button
                type="button"
                disabled={disabled}
                aria-current={activeId === item.id ? 'true' : undefined}
                aria-label={t('itemNumber', { number: index + 1 })}
                onClick={() => onSelect(item.id)}
              >
                <div className={importStyles.candidateImage}>
                  <CropPreview
                    url={job.sourceUrl}
                    box={item.data.objectBox}
                    sourceRatio={job.width / job.height}
                    label={t('thumbnail')}
                    size={64}
                  />
                </div>
                <span className={importStyles.candidateContent}>
                  <strong>
                    {index + 1}. {values.name || t('unnamed')}
                  </strong>
                  <span className={importStyles.candidatePrices}>
                    <span>
                      {t('candidatePurchasePrice', {
                        price: purchasePrice === null ? '—' : Number(purchasePrice).toFixed(2),
                        unit,
                      })}
                    </span>
                    <span>
                      {t('candidateSalePrice', {
                        price: salePrice === null ? '—' : Number(salePrice).toFixed(2),
                        unit,
                      })}
                    </span>
                  </span>
                  {priceAdjusted && (
                    <span className={importStyles.candidateRecognition}>
                      {t('recognizedPriceAdjusted', {
                        price: Number(item.data.price).toFixed(2),
                      })}
                    </span>
                  )}
                  <Tag color={item.entryId ? 'success' : item.data.reviewed ? 'blue' : 'default'}>
                    {t(
                      item.entryId
                        ? 'candidateImported'
                        : item.data.reviewed
                          ? 'candidateReviewed'
                          : 'candidatePending',
                    )}
                  </Tag>
                  {!!issues.length && (
                    <span className={importStyles.candidateError}>
                      {issues.map((issue) => t(`validation.${issue.code}`)).join('；')}
                    </span>
                  )}
                  {!!item.data.warnings.length && (
                    <span className={importStyles.candidateWarning}>
                      {t('warningCount', { count: item.data.warnings.length })}
                    </span>
                  )}
                </span>
              </button>
            </article>
          );
        })}
      </div>
      {!job.items.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noItems')} />
      )}
    </section>
  );
}
