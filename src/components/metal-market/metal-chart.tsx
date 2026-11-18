'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { MetalPoint } from '@/lib/metal-market';
import type { MarketCopy } from './copy';
import marketStyles from './metal-market.module.css';

export function MetalChart({ points, copy }: { points: MetalPoint[]; copy: MarketCopy }) {
  const gradientId = useId();
  const canvas = useRef<SVGSVGElement>(null);
  const [{ width, height }, setSize] = useState({ width: 760, height: 230 });
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  const left = Math.max(...points.map((point) => point.price)).toFixed(2).length > 5 ? 66 : 48;
  const right = width - 12;
  const top = 18;
  const bottom = height - 35;
  const prices = points.map((point) => point.price);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  const padding = Math.max((highest - lowest) * 0.14, 0.025);
  const min = lowest - padding;
  const max = highest + padding;
  const start = Date.parse(points[0].date);
  const end = Date.parse(points[points.length - 1].date);
  const coordinates = points.map((point) => ({
    x:
      points.length === 1
        ? (left + right) / 2
        : left + ((Date.parse(point.date) - start) / (end - start)) * (right - left),
    y: bottom - ((point.price - min) / (max - min)) * (bottom - top),
  }));
  const line = coordinates
    .map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const last = coordinates[coordinates.length - 1];
  const focusIndex = selected === null ? points.length - 1 : Math.min(selected, points.length - 1);
  const point = points[focusIndex];
  const position = coordinates[focusIndex];
  const ticks = Array.from(
    new Set(
      width < 460
        ? [0, points.length - 1]
        : [0, Math.round((points.length - 1) / 2), points.length - 1],
    ),
  );

  return (
    <div className={marketStyles.chart}>
      <div className={marketStyles.chartReadout} aria-live="polite" aria-atomic="true">
        <span>{point.date}</span>
        <strong>¥{point.price.toFixed(3)}</strong>
        <span>{copy.gram}</span>
      </div>
      <svg
        ref={canvas}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={copy.chartLabel}
        tabIndex={0}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - bounds.left) / bounds.width) * width;
          let index = 0;
          for (let i = 1; i < coordinates.length; i++)
            if (Math.abs(coordinates[i].x - x) < Math.abs(coordinates[index].x - x)) index = i;
          setSelected(index);
        }}
        onPointerLeave={() => setSelected(null)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          setSelected(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? points.length - 1
                : Math.min(
                    points.length - 1,
                    Math.max(0, focusIndex + (event.key === 'ArrowRight' ? 1 : -1)),
                  ),
          );
        }}
      >
        <title>{copy.chartLabel}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#789b84" stopOpacity=".24" />
            <stop offset="1" stopColor="#789b84" stopOpacity=".015" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((index) => {
          const y = top + (index / 3) * (bottom - top);
          return (
            <g key={index}>
              <line x1={left} x2={right} y1={y} y2={y} className={marketStyles.gridLine} />
              <text x={left - 12} y={y + 4} textAnchor="end" className={marketStyles.axisLabel}>
                {(max - (index / 3) * (max - min)).toFixed(2)}
              </text>
            </g>
          );
        })}
        <path
          d={`${line} L${last.x},${bottom} L${coordinates[0].x},${bottom} Z`}
          fill={`url(#${gradientId})`}
        />
        <path d={line} className={marketStyles.chartLine} vectorEffect="non-scaling-stroke" />
        {ticks.map((index) => (
          <text
            key={index}
            x={coordinates[index].x}
            y={height - 8}
            textAnchor={
              ticks.length === 1
                ? 'middle'
                : index === 0
                  ? 'start'
                  : index === points.length - 1
                    ? 'end'
                    : 'middle'
            }
            className={marketStyles.axisLabel}
          >
            {points[index].date}
          </text>
        ))}
        <line
          x1={position.x}
          x2={position.x}
          y1={top}
          y2={bottom}
          className={marketStyles.crosshair}
        />
        <circle cx={position.x} cy={position.y} r="5" className={marketStyles.chartDot} />
      </svg>
      <p className={marketStyles.chartHint}>{copy.chartHint}</p>
      <div className={marketStyles.rangeStats}>
        <div>
          <span>{copy.rangeHigh}</span>
          <strong>¥{highest.toFixed(3)}</strong>
        </div>
        <div>
          <span>{copy.rangeLow}</span>
          <strong>¥{lowest.toFixed(3)}</strong>
        </div>
        <span>
          {points.length.toLocaleString()} {copy.days}
        </span>
      </div>
    </div>
  );
}
