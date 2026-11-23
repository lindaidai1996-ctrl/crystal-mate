'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { MaterialCategory } from '@/lib/client-types';
import type { DateRange } from '@/lib/date-range';
import { categoryPath, categoryTree } from '@/components/materialManagement/categoryTree';
import { FilterChoices, MobileFilters } from './mobileFilters';
import { MobileDateRange, validMobileDateRange } from './mobileDateRange';

type Values = {
  categoryId?: string;
  source?: 'IMAGE_IMPORT' | 'OTHER';
  pricing?: 'GROUPED' | 'ORDINARY';
  createdRange: DateRange;
};

export function MaterialListFilters({
  value,
  onApply,
  categories,
  search,
  children,
}: {
  value: Values;
  onApply: (value: Values) => void;
  categories: MaterialCategory[];
  search: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('materials');
  const mobile = useTranslations('mobile');
  const pricing = useTranslations('materialPricing');
  function renderCategories(draft: Values, update: (patch: Partial<Values>) => void) {
    const path = categoryPath(draft.categoryId ?? null, categories);
    let options = categoryTree(categories);
    const rows = [{ parentId: undefined as string | undefined, label: t('category'), options }];
    for (const id of path) {
      const node = options.find((item) => item.value === id);
      if (!node?.children?.length) break;
      rows.push({
        parentId: id,
        label: t('subcategoryOf', { name: node.label }),
        options: node.children,
      });
      options = node.children;
    }
    return rows.map((row, index) => (
      <FilterChoices
        key={row.parentId ?? 'root'}
        label={row.label}
        value={path[index] ?? ''}
        options={[{ value: '', label: t('tabAll') }, ...row.options]}
        onChange={(id) => update({ categoryId: id || row.parentId })}
      />
    ));
  }
  const count = value.createdRange ? 1 : 0;
  return (
    <MobileFilters
      value={value}
      onApply={onApply}
      search={search}
      groups={[
        {
          key: 'category',
          label:
            categories.find((item) => item.id === value.categoryId)?.name ??
            mobile('allCategories'),
          active: !!value.categoryId,
          reset: (draft) => ({ ...draft, categoryId: undefined }),
          render: renderCategories,
        },
        {
          key: 'source',
          label: value.source
            ? t(value.source === 'IMAGE_IMPORT' ? 'sourceImageImport' : 'sourceOther')
            : t('source'),
          active: !!value.source,
          reset: (draft) => ({ ...draft, source: undefined }),
          render: (draft, update) => (
            <FilterChoices
              label={t('source')}
              value={draft.source ?? ''}
              options={[
                { value: '', label: t('allSources') },
                { value: 'IMAGE_IMPORT', label: t('sourceImageImport') },
                { value: 'OTHER', label: t('sourceOther') },
              ]}
              onChange={(source) =>
                update({
                  source: source === 'IMAGE_IMPORT' || source === 'OTHER' ? source : undefined,
                })
              }
            />
          ),
        },
        {
          key: 'pricing',
          label: value.pricing
            ? pricing(value.pricing === 'GROUPED' ? 'grouped' : 'ordinary')
            : pricing('pricingFilter'),
          active: !!value.pricing,
          reset: (draft) => ({ ...draft, pricing: undefined }),
          render: (draft, update) => (
            <FilterChoices
              label={pricing('pricingFilter')}
              value={draft.pricing ?? ''}
              options={[
                { value: '', label: pricing('allPricing') },
                { value: 'GROUPED', label: pricing('grouped') },
                { value: 'ORDINARY', label: pricing('ordinary') },
              ]}
              onChange={(value) =>
                update({ pricing: value === 'GROUPED' || value === 'ORDINARY' ? value : undefined })
              }
            />
          ),
        },
        {
          key: 'filters',
          height: 'min(90dvh, 800px)',
          label: mobile('filters'),
          active: count > 0,
          count,
          reset: (draft) => ({ ...draft, createdRange: null }),
          valid: (draft) => validMobileDateRange(draft.createdRange),
          render: (draft, update) => (
            <MobileDateRange
              value={draft.createdRange}
              onChange={(createdRange) => update({ createdRange })}
            />
          ),
        },
      ]}
    >
      {children}
    </MobileFilters>
  );
}
