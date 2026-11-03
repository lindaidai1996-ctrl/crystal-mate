'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { Button, Select, Space } from 'antd';
import { useTranslations } from 'next-intl';
import type { DiyImage, DiyPart } from '@/lib/diyImageImport/contracts';
import type { ImportBox } from '@/lib/materialImageImport/contracts';
import styles from './diyImport.module.css';

export function DiyImageCanvas({
  image,
  parts,
  activeId,
  disabled,
  onSelect,
  onBox,
}: {
  image: DiyImage;
  parts: DiyPart[];
  activeId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onBox: (box: ImportBox) => void;
}) {
  const t = useTranslations('diyImport');
  const [zoom, setZoom] = useState(100);
  const [framing, setFraming] = useState(false);
  const [drawing, setDrawing] = useState<ImportBox | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((event.clientY - bounds.top) / bounds.height) * 1000)),
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const end = point(event);
    const box = {
      x: Math.min(start.current.x, end.x),
      y: Math.min(start.current.y, end.y),
      width: Math.abs(end.x - start.current.x),
      height: Math.abs(end.y - start.current.y),
    };
    setDrawing(box);
    return box;
  }
  const active = parts.find((part) => part.id === activeId);
  const canFrame = !disabled && !!active && !active.excluded;
  return (
    <section className={styles.photoSection}>
      <Space wrap className={styles.canvasToolbar}>
        <Button
          type={framing ? 'primary' : 'default'}
          disabled={!canFrame}
          onClick={() => setFraming(!framing)}
        >
          {t(framing ? 'finishFrame' : 'drawFrame')}
        </Button>
        <Select
          aria-label={t('zoom')}
          value={zoom}
          onChange={setZoom}
          options={[100, 150, 200, 300].map((value) => ({ value, label: `${value}%` }))}
        />
        <span className={styles.muted}>{t('frameHint')}</span>
      </Space>
      <div className={styles.photoViewport}>
        <div
          className={styles.canvas}
          style={{
            width: `${zoom}%`,
            aspectRatio: `${image.width}/${image.height}`,
            touchAction: framing && canFrame ? 'none' : 'auto',
          }}
          onPointerDown={(event) => {
            if (!framing || !canFrame || event.button !== 0) return;
            start.current = point(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={(event) => {
            const box = move(event);
            if (box && box.width >= 1 && box.height >= 1 && canFrame) onBox(box);
            start.current = null;
            setDrawing(null);
            setFraming(false);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrawing(null);
          }}
        >
          {/* The image keeps its source geometry so normalized evidence boxes stay aligned. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.fileName} draggable={false} />
          {parts
            .filter((part) => !part.excluded)
            .flatMap((part, index) => {
              const view = part.views.find((view) => view.imageId === image.id);
              if (!view || (drawing && part.id === activeId)) return [];
              return [
                <button
                  key={part.id}
                  type="button"
                  aria-label={part.name || t('partNumber', { number: index + 1 })}
                  disabled={framing}
                  className={`${styles.box} ${part.id === activeId ? styles.activeBox : ''}`}
                  style={{
                    left: `${view.box.x / 10}%`,
                    top: `${view.box.y / 10}%`,
                    width: `${view.box.width / 10}%`,
                    height: `${view.box.height / 10}%`,
                  }}
                  onClick={() => onSelect(part.id)}
                >
                  <span>
                    {index + 1}. {part.name}
                  </span>
                </button>,
              ];
            })}
          {drawing && (
            <div
              className={`${styles.box} ${styles.activeBox}`}
              style={{
                left: `${drawing.x / 10}%`,
                top: `${drawing.y / 10}%`,
                width: `${drawing.width / 10}%`,
                height: `${drawing.height / 10}%`,
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
