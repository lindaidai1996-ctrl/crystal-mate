'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, Modal, Radio, Select, Space } from 'antd';
import type { ImageImport, ImportBox } from '@/lib/materialImageImport/contracts';
import importStyles from './materialImageImport.module.css';

export function CropPreview({
  url,
  box,
  label,
  sourceRatio,
  size = 160,
  preview = false,
}: {
  url: string;
  box: ImportBox;
  label: string;
  sourceRatio: number;
  size?: number;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ratio = (box.width * sourceRatio) / box.height;
  const cropStyle = {
    aspectRatio: String(ratio),
    backgroundImage: `url(${JSON.stringify(url)})`,
    backgroundSize: `${100000 / box.width}% ${100000 / box.height}%`,
    backgroundPosition: `${box.width === 1000 ? 0 : (box.x / (1000 - box.width)) * 100}% ${box.height === 1000 ? 0 : (box.y / (1000 - box.height)) * 100}%`,
  };
  const thumbnail = (
    <div
      className={importStyles.cropPreview}
      role="img"
      aria-label={label}
      style={{
        ...cropStyle,
        width: `${Math.min(size, size * ratio)}px`,
      }}
    />
  );

  if (!preview) return thumbnail;

  return (
    <>
      <button
        type="button"
        className={importStyles.cropPreviewButton}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {thumbnail}
      </button>
      <Modal
        title={label}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        centered
        width={960}
      >
        <div className={importStyles.enlargedCrop}>
          <div
            className={importStyles.cropPreview}
            role="img"
            aria-label={label}
            style={{ ...cropStyle, width: `min(100%, calc(70dvh * ${ratio}))` }}
          />
        </div>
      </Modal>
    </>
  );
}

export function ImportImageCanvas({
  job,
  activeId,
  originalBoxes,
  disabled,
  onBox,
  onClearPrice,
}: {
  job: ImageImport;
  activeId: string;
  originalBoxes: { objectBox: ImportBox; priceBox: ImportBox | null };
  disabled: boolean;
  onBox: (field: 'objectBox' | 'priceBox', box: ImportBox) => void;
  onClearPrice: () => void;
}) {
  const t = useTranslations('imageImport');
  const [mode, setMode] = useState<'objectBox' | 'priceBox'>('objectBox');
  const [zoom, setZoom] = useState(100);
  const [drawing, setDrawing] = useState<ImportBox | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [redrawn, setRedrawn] = useState({ objectBox: false, priceBox: false });
  const start = useRef<{ x: number; y: number } | null>(null);
  const active = job.items.find((item) => item.id === activeId);
  const editable = !disabled && active && !active.entryId;

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

  const outlines: {
    field: 'objectBox' | 'priceBox';
    box: ImportBox | null | undefined;
    original?: boolean;
  }[] = drawing
    ? [{ field: mode, box: drawing }]
    : [
        { field: 'objectBox', box: redrawn.objectBox ? active?.data.objectBox : null },
        { field: 'priceBox', box: redrawn.priceBox ? active?.data.priceBox : null },
        { field: 'objectBox', box: showOriginal ? originalBoxes.objectBox : null, original: true },
        { field: 'priceBox', box: showOriginal ? originalBoxes.priceBox : null, original: true },
      ];

  return (
    <section className={importStyles.canvasSection}>
      <Space wrap className={importStyles.canvasToolbar}>
        <Radio.Group
          size="small"
          value={mode}
          disabled={!editable}
          onChange={(event) => setMode(event.target.value)}
          optionType="button"
          options={[
            { value: 'objectBox', label: t('drawObject') },
            { value: 'priceBox', label: t('drawPrice') },
          ]}
        />
        <Select
          size="small"
          aria-label={t('imageZoom')}
          value={zoom}
          onChange={setZoom}
          options={[100, 150, 200, 300].map((value) => ({ value, label: `${value}%` }))}
        />
        <Button size="small" disabled={!editable} onClick={onClearPrice}>
          {t('clearPriceBox')}
        </Button>
        <Checkbox
          checked={showOriginal}
          onChange={(event) => setShowOriginal(event.target.checked)}
        >
          {t('showOriginalBoxes')}
        </Checkbox>
      </Space>
      <p className={importStyles.hint}>{t('drawHint')}</p>
      <div className={importStyles.canvasViewport}>
        <div
          className={importStyles.canvas}
          style={{
            width: `${zoom}%`,
            aspectRatio: `${job.width} / ${job.height}`,
            touchAction: 'none',
          }}
          onPointerDown={(event) => {
            if (!editable || event.button !== 0) return;
            start.current = point(event);
            setDrawing({ ...start.current, width: 0, height: 0 });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={(event) => {
            const box = move(event);
            if (editable && box && box.width >= 1 && box.height >= 1) {
              onBox(mode, box);
              setRedrawn((current) => ({ ...current, [mode]: true }));
            }
            start.current = null;
            setDrawing(null);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrawing(null);
          }}
        >
          {/* The authenticated source retains its original pixel geometry at every zoom level. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={job.sourceUrl} alt={job.fileName} draggable={false} />
          {outlines.map(
            ({ field, box, original }) =>
              box && (
                <div
                  key={`${original ? 'original' : 'selection'}-${field}`}
                  className={[
                    field === 'objectBox' ? importStyles.box : importStyles.priceBox,
                    original ? importStyles.originalBox : '',
                  ].join(' ')}
                  role="img"
                  aria-label={t(field === 'objectBox' ? 'thumbnail' : 'priceEvidence')}
                  style={{
                    left: `${box.x / 10}%`,
                    top: `${box.y / 10}%`,
                    width: `${box.width / 10}%`,
                    height: `${box.height / 10}%`,
                  }}
                />
              ),
          )}
        </div>
      </div>
    </section>
  );
}
