'use client';

import { Select } from 'antd';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { Category, SettingStyle, Tag } from '@/lib/client-types';
import type { DateRange } from '@/lib/date-range';
import { FilterChoices, MobileFilters, type MobileFilterGroup } from './mobileFilters';
import { MobileDateRange, validMobileDateRange } from './mobileDateRange';
import mobileStyles from './responsive.module.css';

type MarketingField = 'videoShot' | 'xiaohongshuVideoPublished' | 'xiaohongshuListed';
export type ProductListFilterValues = {
  categoryId?: string;
  tagId?: string;
  settingStyleId?: string;
  published?: string;
  origin: 'all' | 'PURCHASED' | 'DIY';
  stock?: string;
  marketingFilters: Record<MarketingField, '' | 'true' | 'false'>;
  createdRange: DateRange;
  priceSort: 'ascend' | 'descend' | null;
};

const marketingFields: MarketingField[] = [
  'videoShot',
  'xiaohongshuVideoPublished',
  'xiaohongshuListed',
];

export function ProductListFilters({
  value,
  onApply,
  categories,
  tags,
  settingStyles,
  isCabochon,
  isFinishedStrands,
  search,
  children,
}: {
  value: ProductListFilterValues;
  onApply: (value: ProductListFilterValues) => void;
  categories: Category[];
  tags: Tag[];
  settingStyles: SettingStyle[];
  isCabochon: boolean;
  isFinishedStrands: boolean;
  search: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('products');
  const editor = useTranslations('editor');
  const mobile = useTranslations('mobile');
  const extraCount = [
    value.tagId,
    isCabochon && value.settingStyleId,
    !isCabochon && value.published,
    isFinishedStrands && value.origin !== 'all',
    value.stock,
    value.createdRange,
    ...(isCabochon ? Object.values(value.marketingFilters) : []),
  ].filter(Boolean).length;
  const groups: MobileFilterGroup<ProductListFilterValues>[] = [
    ...(!isCabochon
      ? [
          {
            key: 'category',
            label:
              categories.find((item) => item.id === value.categoryId)?.name ??
              mobile('allCategories'),
            active: !!value.categoryId,
            reset: (draft: ProductListFilterValues) => ({ ...draft, categoryId: undefined }),
            render: (
              draft: ProductListFilterValues,
              update: (patch: Partial<ProductListFilterValues>) => void,
            ) => (
              <FilterChoices
                label={t('category')}
                value={draft.categoryId ?? ''}
                options={[
                  { value: '', label: t('all') },
                  ...categories.map((item) => ({ value: item.id, label: item.name })),
                ]}
                onChange={(id) => update({ categoryId: id || undefined })}
              />
            ),
          },
        ]
      : []),
    {
      key: 'sort',
      label:
        value.priceSort === 'ascend'
          ? t('sortPriceAsc')
          : value.priceSort === 'descend'
            ? t('sortPriceDesc')
            : mobile('sort'),
      active: !!value.priceSort,
      reset: (draft) => ({ ...draft, priceSort: null }),
      render: (draft, update) => (
        <FilterChoices
          label={t('sort')}
          value={draft.priceSort ?? ''}
          options={[
            { value: '', label: t('sortDefault') },
            { value: 'ascend', label: t('sortPriceAsc') },
            { value: 'descend', label: t('sortPriceDesc') },
          ]}
          onChange={(sort) =>
            update({ priceSort: sort === 'ascend' || sort === 'descend' ? sort : null })
          }
        />
      ),
    },
    {
      key: 'filters',
      label: mobile('filters'),
      active: extraCount > 0,
      count: extraCount,
      reset: (draft) => ({
        ...draft,
        tagId: undefined,
        settingStyleId: undefined,
        published: undefined,
        origin: 'all',
        stock: undefined,
        createdRange: null,
        marketingFilters: { videoShot: '', xiaohongshuVideoPublished: '', xiaohongshuListed: '' },
      }),
      valid: (draft) => validMobileDateRange(draft.createdRange),
      render: (draft, update) => (
        <>
          {isFinishedStrands && (
            <FilterChoices
              label={t('originFilter')}
              value={draft.origin}
              options={[
                { value: 'all', label: t('all') },
                { value: 'PURCHASED', label: t('purchased') },
                { value: 'DIY', label: t('diy') },
              ]}
              onChange={(origin) => update({ origin })}
            />
          )}
          <FilterChoices
            label={t('stockFilter')}
            value={draft.stock ?? ''}
            options={[
              { value: '', label: t('all') },
              { value: '1', label: t('inStock') },
              { value: '0', label: t('soldOut') },
            ]}
            onChange={(stock) => update({ stock: stock || undefined })}
          />
          {!isCabochon && (
            <FilterChoices
              label={t('publication')}
              value={draft.published ?? ''}
              options={[
                { value: '', label: t('all') },
                { value: 'true', label: t('published') },
                { value: 'false', label: t('unpublished') },
              ]}
              onChange={(published) => update({ published: published || undefined })}
            />
          )}
          <fieldset className={mobileStyles.choiceGroup}>
            <legend>{t('tags')}</legend>
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              aria-label={t('tags')}
              placeholder={t('all')}
              value={draft.tagId}
              options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
              onChange={(tagId) => update({ tagId })}
            />
          </fieldset>
          {isCabochon && (
            <>
              <fieldset className={mobileStyles.choiceGroup}>
                <legend>{t('setting')}</legend>
                <Select
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  aria-label={t('setting')}
                  placeholder={t('all')}
                  value={draft.settingStyleId}
                  options={[
                    ...settingStyles.map((item) => ({ value: item.id, label: item.magicBoxStyle })),
                    { value: 'unset', label: t('unsetSetting') },
                  ]}
                  onChange={(settingStyleId) => update({ settingStyleId })}
                />
              </fieldset>
              {marketingFields.map((field) => (
                <FilterChoices
                  key={field}
                  label={editor(field)}
                  value={draft.marketingFilters[field]}
                  options={[
                    { value: '', label: t('all') },
                    { value: 'true', label: t('completed') },
                    { value: 'false', label: t('incomplete') },
                  ]}
                  onChange={(next) =>
                    update({ marketingFilters: { ...draft.marketingFilters, [field]: next } })
                  }
                />
              ))}
            </>
          )}
          <MobileDateRange
            value={draft.createdRange}
            onChange={(createdRange) => update({ createdRange })}
          />
        </>
      ),
    },
  ];
  return (
    <MobileFilters value={value} groups={groups} onApply={onApply} search={search}>
      {children}
    </MobileFilters>
  );
}
