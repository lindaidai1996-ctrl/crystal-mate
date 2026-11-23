'use client';

import { useState, type CSSProperties } from 'react';
import { Empty } from 'antd';
import { Decimal } from '@prisma/client/runtime/index-browser.js';
import { useTranslations } from 'next-intl';
import { formatAmount } from '@/lib/format-money';
import analysisStyles from './procurementAnalytics.module.css';

type Slice = { key: string; name: string; value: string | null };

export function ProcurementPieChart({
  items,
  label,
  unit,
}: {
  items: Slice[];
  label: string;
  unit: string;
}) {
  const t = useTranslations('procurementAnalytics');
  const [selected, setSelected] = useState<string | null>(null);
  const sorted = items
    .filter((item) => item.value !== null && new Decimal(item.value).gt(0))
    .sort((a, b) => new Decimal(b.value!).cmp(a.value!));
  const slices = sorted.slice(0, 7);
  if (sorted.length > 7)
    slices.push({
      key: 'other',
      name: t('other'),
      value: sorted
        .slice(7)
        .reduce((sum, item) => sum.plus(item.value!), new Decimal(0))
        .toFixed(2),
    });
  if (!slices.length)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noPositiveData')} />;
  const total = slices.reduce((sum, item) => sum.plus(item.value!), new Decimal(0));
  const focused = slices.find((item) => item.key === selected);
  return (
    <div className={analysisStyles.pieLayout}>
      <div className={analysisStyles.pieCanvas}>
        <svg viewBox="0 0 220 220" role="img" aria-label={label}>
          <title>{label}</title>
          {slices.map((slice, index) => {
            const percent = new Decimal(slice.value!).div(total).mul(100).toNumber();
            const start = slices
              .slice(0, index)
              .reduce((sum, item) => sum.plus(item.value!), new Decimal(0))
              .div(total)
              .mul(100)
              .toNumber();
            return (
              <circle
                key={slice.key}
                cx="110"
                cy="110"
                r="84"
                fill="none"
                pathLength="100"
                strokeWidth={selected === slice.key ? 30 : 24}
                strokeDasharray={`${percent} ${100 - percent}`}
                strokeDashoffset={-start}
                transform="rotate(-90 110 110)"
                className={analysisStyles.pieSlice}
                style={
                  {
                    '--slice-color': `var(--analysis-color-${index})`,
                    opacity:
                      selected && !focused ? 1 : !selected || selected === slice.key ? 1 : 0.35,
                  } as CSSProperties
                }
                onPointerEnter={() => setSelected(slice.key)}
              >
                <title>
                  {slice.name}: {formatAmount(slice.value)} {unit} ({percent.toFixed(1)}%)
                </title>
              </circle>
            );
          })}
        </svg>
        <div className={analysisStyles.pieCenter} aria-live="polite">
          <span>{focused?.name ?? t('total')}</span>
          <strong>{formatAmount(focused?.value ?? total.toFixed(2))}</strong>
          <small>{unit}</small>
        </div>
      </div>
      <ul className={analysisStyles.legend}>
        {slices.map((slice, index) => (
          <li key={slice.key}>
            <button
              type="button"
              aria-pressed={selected === slice.key}
              onClick={() => setSelected(selected === slice.key ? null : slice.key)}
              style={{ '--slice-color': `var(--analysis-color-${index})` } as CSSProperties}
            >
              <i aria-hidden="true" />
              <span>{slice.name}</span>
              <strong>{new Decimal(slice.value!).div(total).mul(100).toFixed(1)}%</strong>
              <small>
                {formatAmount(slice.value)} {unit}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
