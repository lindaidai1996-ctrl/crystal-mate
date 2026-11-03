'use client';

import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { Button, Grid } from 'antd';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { MaterialCategory } from '@/lib/client-types';
import { categoryPath, categoryTree, type CategoryNode } from './categoryTree';
import categoryStyles from './materialCategoryFilter.module.css';

function CategoryRow({
  label,
  options,
  selectedId,
  parentId,
  limit,
  onChange,
}: {
  label: string;
  options: CategoryNode[];
  selectedId?: string;
  parentId?: string;
  limit: number;
  onChange: (categoryId: string | undefined) => void;
}) {
  const t = useTranslations('materials');
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === selectedId);
  // Keep a selected category visible when returning to a shortcut or narrowing the screen.
  const visibleOptions = expanded
    ? options
    : options.filter(
        (_, index) => index < limit - (selectedIndex >= limit ? 1 : 0) || index === selectedIndex,
      );

  return (
    <div className={categoryStyles.row} role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className={categoryStyles.label}>
        {label}
      </span>
      <div className={categoryStyles.choices}>
        <div id={`${id}-choices`} className={categoryStyles.options}>
          <Button
            className={categoryStyles.option}
            color={!selectedId ? 'primary' : 'default'}
            variant={!selectedId ? 'filled' : 'text'}
            aria-pressed={!selectedId}
            onClick={() => onChange(parentId)}
          >
            {t('tabAll')}
          </Button>
          {visibleOptions.map((option) => (
            <Button
              key={option.value}
              className={categoryStyles.option}
              color={selectedId === option.value ? 'primary' : 'default'}
              variant={selectedId === option.value ? 'filled' : 'text'}
              aria-pressed={selectedId === option.value}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {options.length > limit && (
          <Button
            type="link"
            className={categoryStyles.toggle}
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            iconPosition="end"
            aria-expanded={expanded}
            aria-controls={`${id}-choices`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('collapseCategories') : t('expandCategories')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function MaterialCategoryFilter({
  categories,
  value,
  onChange,
}: {
  categories: MaterialCategory[];
  value?: string;
  onChange: (categoryId: string | undefined) => void;
}) {
  const t = useTranslations('materials');
  const screens = Grid.useBreakpoint();
  const limit = screens.sm ? 8 : 4;
  const path = categoryPath(value ?? null, categories);
  const roots = categoryTree(categories);
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
        <CategoryRow
          key={row.parentId ?? 'root'}
          {...row}
          selectedId={path[index]}
          limit={limit}
          onChange={(categoryId) => {
            if (categoryId !== value) onChange(categoryId);
          }}
        />
      ))}
    </div>
  );
}
