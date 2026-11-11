'use client';

import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { Button, Skeleton } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import categoryStyles from './categoryFilter.module.css';
import type { CategoryCountState } from './useCategoryCounts';

export function CategoryFilterRow({
  label,
  options,
  selectedId,
  parentId,
  counts,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selectedId?: string;
  parentId?: string;
  counts?: CategoryCountState;
  onChange: (categoryId: string | undefined) => void;
}) {
  const t = useTranslations('materials');
  const common = useTranslations('common');
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

  function renderCount(categoryId?: string) {
    if (!counts) return null;
    const value = counts.data
      ? categoryId
        ? (counts.data.byCategory[categoryId] ?? 0)
        : counts.data.total
      : '—';
    return (
      <span
        className={categoryStyles.count}
        aria-busy={counts.loading}
        title={counts.error ? common('errors.SERVER_ERROR') : undefined}
      >
        （
        {counts.loading ? (
          <Skeleton.Input
            active
            size="small"
            style={{ width: 24, minWidth: 24, height: 14, verticalAlign: 'middle' }}
            aria-label={common('loading')}
          />
        ) : (
          <span className={categoryStyles.countValue}>{value}</span>
        )}
        ）
      </span>
    );
  }

  return (
    <div className={categoryStyles.row} role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className={categoryStyles.label}>
        {label}
        {counts?.error && (
          <Button type="link" size="small" onClick={counts.retry}>
            {common('retry')}
          </Button>
        )}
      </span>
      <div ref={choicesRef} className={categoryStyles.choices}>
        <div ref={optionsRef} id={`${id}-choices`} className={categoryStyles.options}>
          <Button
            autoInsertSpace={false}
            className={categoryStyles.option}
            color={!selectedId ? 'primary' : 'default'}
            variant={!selectedId ? 'filled' : 'text'}
            aria-pressed={!selectedId}
            onClick={() => onChange(parentId)}
          >
            <span>{t('tabAll')}</span>
            {renderCount(parentId)}
          </Button>
          {options.map((option, index) => {
            const hidden = !expanded && index >= limit && index !== selectedIndex;
            return (
              <Button
                key={option.value}
                autoInsertSpace={false}
                className={`${categoryStyles.option} ${hidden ? categoryStyles.hidden : ''}`}
                inert={hidden}
                aria-hidden={hidden || undefined}
                color={selectedId === option.value ? 'primary' : 'default'}
                variant={selectedId === option.value ? 'filled' : 'text'}
                aria-pressed={selectedId === option.value}
                onClick={() => onChange(option.value)}
              >
                <span>{option.label}</span>
                {renderCount(option.value)}
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
