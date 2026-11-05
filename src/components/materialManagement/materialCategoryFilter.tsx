'use client';

import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MaterialCategory } from '@/lib/client-types';
import { categoryPath, categoryTree, type CategoryNode } from './categoryTree';
import categoryStyles from './materialCategoryFilter.module.css';

function CategoryRow({
  label,
  options,
  selectedId,
  parentId,
  onChange,
}: {
  label: string;
  options: CategoryNode[];
  selectedId?: string;
  parentId?: string;
  onChange: (categoryId: string | undefined) => void;
}) {
  const t = useTranslations('materials');
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(Infinity);
  const choicesRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === selectedId);
  const hasOverflow = options.some((_, index) => index >= limit && index !== selectedIndex);

  useEffect(() => {
    const choices = choicesRef.current;
    const optionList = optionsRef.current;
    const toggle = toggleRef.current;
    if (!choices || !optionList || !toggle) return;
    const buttons = Array.from(optionList.querySelectorAll('button'));

    const measure = () => {
      const width = choices.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(optionList).columnGap) || 0;
      const widths = buttons.map((button) => button.getBoundingClientRect().width);
      const total = widths.reduce((sum, itemWidth) => sum + itemWidth, 0) + gap * options.length;
      if (total <= width) {
        setLimit(options.length);
        return;
      }

      const available = width - toggle.getBoundingClientRect().width - gap;
      // Reserve the selected category so it remains visible even if it is near the end.
      let used = widths[0] + (selectedIndex >= 0 ? widths[selectedIndex + 1] + gap : 0);
      let count = 0;
      for (let index = 0; index < options.length; index++) {
        if (index !== selectedIndex) {
          const nextWidth = used + gap + widths[index + 1];
          if (nextWidth > available) break;
          used = nextWidth;
        }
        count = index + 1;
      }
      setLimit(count);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(choices);
    observer.observe(toggle);
    buttons.forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [options, selectedIndex]);

  return (
    <div className={categoryStyles.row} role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className={categoryStyles.label}>
        {label}
      </span>
      <div ref={choicesRef} className={categoryStyles.choices}>
        <div ref={optionsRef} id={`${id}-choices`} className={categoryStyles.options}>
          <Button
            className={categoryStyles.option}
            color={!selectedId ? 'primary' : 'default'}
            variant={!selectedId ? 'filled' : 'text'}
            aria-pressed={!selectedId}
            onClick={() => onChange(parentId)}
          >
            {t('tabAll')}
          </Button>
          {options.map((option, index) => {
            const hidden = !expanded && index >= limit && index !== selectedIndex;
            return (
              <Button
                key={option.value}
                className={`${categoryStyles.option} ${hidden ? categoryStyles.hidden : ''}`}
                inert={hidden}
                aria-hidden={hidden || undefined}
                color={selectedId === option.value ? 'primary' : 'default'}
                variant={selectedId === option.value ? 'filled' : 'text'}
                aria-pressed={selectedId === option.value}
                onClick={() => onChange(option.value)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        <Button
          ref={toggleRef}
          type="link"
          className={`${categoryStyles.toggle} ${!hasOverflow ? categoryStyles.hidden : ''}`}
          inert={!hasOverflow}
          aria-hidden={!hasOverflow || undefined}
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          iconPosition="end"
          aria-expanded={expanded}
          aria-controls={`${id}-choices`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('collapseCategories') : t('expandCategories')}
        </Button>
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
        <CategoryRow
          key={row.parentId ?? 'root'}
          {...row}
          selectedId={path[index]}
          onChange={(categoryId) => {
            if (categoryId !== value) onChange(categoryId);
          }}
        />
      ))}
    </div>
  );
}
