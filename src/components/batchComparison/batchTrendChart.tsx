'use client';

import { Empty } from 'antd';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { formatAmount } from '@/lib/format-money';
import comparisonStyles from './batchComparison.module.css';

export type BatchTrendPoint = { id: string; name: string; date: string; value: string | null };

export function BatchTrendChart({
  points,
  label,
  suffix,
  bars = false,
  calendarScale = false,
  categoryAxis = false,
  hint,
}: {
  points: BatchTrendPoint[];
  label: string;
  suffix: string;
  bars?: boolean;
  calendarScale?: boolean;
  categoryAxis?: boolean;
  hint?: string;
}) {
  const t = useTranslations('batchComparison');
  const [selected, setSelected] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(640);
  const hasValues = points.some((point) => point.value !== null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setViewportWidth(Math.max(280, entry.contentRect.width));
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [hasValues]);
  const height = 250;
  const left = 80;
  // Categories need a label for every bar; widen the plot rather than omit names.
  const categoryWidth = Math.max(
    96,
    ...points.map((point) => Array.from(point.date).length * 12 + 24),
  );
  const width = categoryAxis
    ? Math.max(viewportWidth, left + points.length * categoryWidth + 24)
    : viewportWidth;
  const right = width - 24;
  const top = 20;
  const bottom = height - 40;
  if (!points.length || !points.some((point) => point.value !== null))
    return <Empty description={t('noChartData')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const maximum = Math.max(...points.map((point) => Number(point.value ?? 0)));
  const ceiling = maximum > 0 ? maximum * 1.15 : 1;
  const step = (right - left) / Math.max(1, points.length);
  const dates = points.map((point) =>
    Date.parse(
      point.date.length === 4
        ? `${point.date}-01-01`
        : point.date.length === 7
          ? `${point.date}-01`
          : point.date,
    ),
  );
  const firstDate = Math.min(...dates),
    lastDate = Math.max(...dates);
  const coordinates = points.map((point, index) => ({
    x:
      calendarScale && lastDate > firstDate
        ? left +
          step / 2 +
          ((dates[index] - firstDate) / (lastDate - firstDate)) * (right - left - step)
        : left + (index + 0.5) * step,
    y: point.value === null ? null : bottom - (Number(point.value) / ceiling) * (bottom - top),
  }));
  const barWidth = Math.min(
    36,
    step * 0.6,
    ...(calendarScale
      ? coordinates.slice(1).map((point, index) => (point.x - coordinates[index].x) * 0.6)
      : []),
  );
  const focusIndex = Math.min(selected ?? points.length - 1, points.length - 1);
  const focus = points[focusIndex];
  const ticks = categoryAxis
    ? points.map((_, index) => index)
    : [
        ...new Set(
          width < 360
            ? [0, points.length - 1]
            : [0, Math.floor((points.length - 1) / 2), points.length - 1],
        ),
      ];
  // Nulls break the line instead of drawing missing prices as zero or joining across gaps.
  const line = coordinates
    .map((point, index) =>
      point.y === null
        ? ''
        : `${index > 0 && coordinates[index - 1].y !== null ? 'L' : 'M'}${point.x},${point.y}`,
    )
    .join(' ');
  function selectPoint(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * width;
    let nearest = 0;
    for (let index = 1; index < coordinates.length; index++)
      if (Math.abs(coordinates[index].x - x) < Math.abs(coordinates[nearest].x - x))
        nearest = index;
    setSelected(nearest);
  }
  return (
    <div>
      <div className={comparisonStyles.readout} aria-live="polite" aria-atomic="true">
        <span>
          {focus.date} · {focus.name}
        </span>
        <strong>
          {formatAmount(focus.value)} {focus.value !== null && suffix}
        </strong>
      </div>
      <div ref={viewport} className={comparisonStyles.chartViewport}>
        <svg
          className={comparisonStyles.chart}
          style={categoryAxis ? { width } : undefined}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={label}
          tabIndex={0}
          onPointerMove={selectPoint}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            selectPoint(event);
          }}
          onPointerLeave={(event) => {
            if (
              event.pointerType === 'mouse' &&
              !event.currentTarget.hasPointerCapture(event.pointerId)
            )
              setSelected(null);
          }}
          onPointerCancel={() => setSelected(null)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            setSelected(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? points.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        focusIndex + (event.key === 'ArrowRight' ? 1 : -1),
                      ),
                    ),
            );
          }}
        >
          <title>{label}</title>
          {[0, 1, 2, 3].map((index) => {
            const y = bottom - (index / 3) * (bottom - top);
            return (
              <g key={index}>
                <line x1={left} x2={right} y1={y} y2={y} className={comparisonStyles.gridLine} />
                <text
                  x={left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className={comparisonStyles.axisLabel}
                >
                  {((ceiling * index) / 3).toLocaleString(undefined, {
                    notation: maximum >= 1_000_000 ? 'compact' : 'standard',
                    maximumFractionDigits: maximum < 0.1 ? 6 : 2,
                  })}
                </text>
              </g>
            );
          })}
          {!bars && <path d={line} className={comparisonStyles.chartLine} />}
          {coordinates.map((point, index) =>
            point.y === null ? null : bars ? (
              <rect
                key={points[index].id}
                x={point.x - barWidth / 2}
                y={point.y}
                width={barWidth}
                height={Math.max(0, bottom - point.y)}
                className={comparisonStyles.bar}
                opacity={focusIndex === index ? 1 : 0.55}
              />
            ) : (
              <circle
                key={points[index].id}
                cx={point.x}
                cy={point.y}
                r={focusIndex === index ? 5 : 3}
                className={comparisonStyles.dot}
              />
            ),
          )}
          <line
            x1={coordinates[focusIndex].x}
            x2={coordinates[focusIndex].x}
            y1={top}
            y2={bottom}
            className={comparisonStyles.crosshair}
          />
          {ticks.map((index) => (
            <text
              key={index}
              x={
                categoryAxis
                  ? coordinates[index].x
                  : Math.max(42, Math.min(width - 42, coordinates[index].x))
              }
              y={height - 12}
              textAnchor="middle"
              className={comparisonStyles.axisLabel}
            >
              {points[index].date}
            </text>
          ))}
        </svg>
      </div>
      <p className={comparisonStyles.hint}>{hint ?? t('chartHint')}</p>
    </div>
  );
}
