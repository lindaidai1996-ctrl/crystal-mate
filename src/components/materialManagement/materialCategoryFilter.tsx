'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { MaterialCategory } from '@/lib/client-types';
import { CategoryFilterRow } from '@/components/categoryFilterRow';
import { categoryPath, categoryTree } from './categoryTree';
import categoryStyles from '@/components/categoryFilter.module.css';
import type { CategoryCountState } from '@/components/useCategoryCounts';

export function MaterialCategoryFilter({
  categories,
  value,
  counts,
  onChange,
}: {
  categories: MaterialCategory[];
  value?: string;
  counts?: CategoryCountState;
  onChange: (categoryId: string | undefined) => void;
}) {
  const t = useTranslations('materials');
  const path = categoryPath(value ?? null, categories);
  const roots = useMemo(() => categoryTree(categories), [categories]);
  const rows = [
    { parentId: undefined as string | undefined, label: t('category'), options: roots },
  ];
  let options = roots;

  for (const id of path) {
    const selected = options.find((option) => option.value === id);
    if (!selected?.children?.length) break;
    rows.push({
      parentId: id,
      label: t('subcategoryOf', { name: selected.label }),
      options: selected.children,
    });
    options = selected.children;
  }

  return (
    <div className={categoryStyles.filters}>
      {rows.map((row, index) => (
        <CategoryFilterRow
          key={row.parentId ?? 'root'}
          {...row}
          selectedId={path[index]}
          counts={counts}
          onChange={(categoryId) => {
            if (categoryId !== value) onChange(categoryId);
          }}
        />
      ))}
    </div>
  );
}
