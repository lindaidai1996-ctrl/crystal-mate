'use client';

import { ExportOutlined, LeftOutlined, PictureOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Modal, Popover, Select, Spin } from 'antd';
import NextImage from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { Material, MaterialBatchEntry, ProductSourceInput } from '@/lib/client-types';

export type MaterialOption = { entry: MaterialBatchEntry; material: Material; label: string };
type UsageUnit = Extract<ProductSourceInput, { origin: 'DIY' }>['materials'][number]['usageUnit'];

export function suggestedMaterialCost(option: MaterialOption, unit: UsageUnit) {
  if (unit === 'GRAM') return option.entry.purchaseGramPrice;
  if (unit === 'STRAND' || option.material.unit === 'BEAD') return option.entry.purchaseUnitPrice;
  return option.entry.childUnitPrice;
}

function materialImages(option: MaterialOption) {
  const batchImages = option.entry.images ?? [];
  const images = batchImages.length ? batchImages : (option.material.images ?? []);
  return images.filter(
    (image, index) => images.findIndex((item) => item.url === image.url) === index,
  );
}

function MaterialPrices({ option }: { option: MaterialOption }) {
  const t = useTranslations('productSources');
  const batchT = useTranslations('materialBatches');
  const unitPrice = option.entry.purchaseUnitPrice;
  const gramPrice = option.entry.purchaseGramPrice;

  return (
    <>
      {batchT('purchaseUnitPrice')}:{' '}
      {unitPrice == null ? '—' : `¥${unitPrice}/${t(option.material.unit)}`}
      {' · '}
      {batchT('gramPrice')}: {gramPrice == null ? '—' : `¥${gramPrice}/${t('GRAM')}`}
    </>
  );
}

function MaterialDetails({ option }: { option: MaterialOption }) {
  return (
    <div className="source-material-details">
      <strong>{option.material.name || option.label}</strong>
      {option.entry.batch && (
        <span>
          {option.entry.batch.name}
          {option.entry.distributor?.name && ` · ${option.entry.distributor.name}`}
        </span>
      )}
      <span>
        <MaterialPrices option={option} />
      </span>
    </div>
  );
}

function MaterialDimensions({ option }: { option: MaterialOption }) {
  const t = useTranslations('productSources');
  const dimensions = [option.entry.lengthMm, option.entry.widthMm, option.entry.heightMm];
  const specification = dimensions.some((value) => value != null)
    ? `${dimensions.map((value) => value ?? '—').join(' × ')} mm`
    : null;
  return (
    <span>
      {specification ? `${t('materialDimensions')}: ${specification}` : t('noMaterialDimensions')}
    </span>
  );
}

type MaterialImagePreview = ReturnType<typeof useMaterialImagePreview>;

function MaterialPreviewButton({
  option,
  preview,
  inDropdown = false,
  dropdownOpen = true,
}: {
  option: MaterialOption;
  preview: MaterialImagePreview;
  inDropdown?: boolean;
  dropdownOpen?: boolean;
}) {
  const t = useTranslations('productSources');
  const [hoverOpen, setHoverOpen] = useState(false);
  const hasImages = materialImages(option).length > 0;

  return (
    <Popover
      placement="right"
      autoAdjustOverflow
      destroyOnHidden
      trigger={['hover', 'focus']}
      mouseEnterDelay={0.2}
      mouseLeaveDelay={0.2}
      open={hoverOpen && dropdownOpen && preview.activeId === option.entry.id}
      onOpenChange={(nextOpen) => {
        setHoverOpen(nextOpen);
        if (nextOpen && hasImages) preview.showHover(option);
      }}
      classNames={{ root: 'source-material-hover-preview' }}
      content={
        <div
          onMouseDown={(event) => {
            // Keep focus in the search input, including when paging through images.
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {preview.content}
        </div>
      }
    >
      <Button
        type={inDropdown ? 'text' : 'link'}
        size="small"
        icon={<PictureOutlined />}
        disabled={!hasImages}
        aria-label={t('viewMaterialImages', { name: option.material.name || option.label })}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            setHoverOpen(true);
            preview.showHover(option);
          } else {
            setHoverOpen(false);
            preview.show(option);
          }
        }}
      >
        {t(hasImages ? 'viewImages' : 'noMaterialImages')}
      </Button>
    </Popover>
  );
}

export function MaterialSourceSelect({
  options,
  selected,
  value,
  onSearch,
  onChange,
  preview,
}: {
  options: MaterialOption[];
  selected?: MaterialOption;
  value: string;
  onSearch: (query: string) => void;
  onChange: (id: string) => void;
  preview: MaterialImagePreview;
}) {
  const t = useTranslations('productSources');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const choices =
    selected && !options.some((option) => option.entry.id === selected.entry.id)
      ? [selected, ...options]
      : options;

  return (
    <div className="source-material-select">
      <Select
        aria-label={t('material')}
        showSearch
        filterOption={false}
        open={open}
        onOpenChange={setOpen}
        searchValue={search}
        onSearch={(query) => {
          setSearch(query);
          onSearch(query);
        }}
        value={value || undefined}
        onChange={(id) => {
          setSearch('');
          onChange(id);
        }}
        virtual={false}
        listHeight={320}
        popupMatchSelectWidth={false}
        classNames={{ popup: { root: 'source-material-popup' } }}
        options={choices.map((option) => ({
          value: option.entry.id,
          label: option.label,
          materialOption: option,
        }))}
        optionRender={({ data }) => {
          const option = data.materialOption;
          return (
            <div className="source-material-option">
              <MaterialDetails option={option} />
              <MaterialPreviewButton
                option={option}
                preview={preview}
                inDropdown
                dropdownOpen={open}
              />
            </div>
          );
        }}
      />
    </div>
  );
}

export function MaterialSourceSummary({
  option,
  preview,
}: {
  option: MaterialOption;
  preview: MaterialImagePreview;
}) {
  const t = useTranslations('productSources');
  const [dimensionsOpen, setDimensionsOpen] = useState(false);
  const dimensionsId = useId();

  return (
    <div className="source-material-selected">
      <div className="source-material-selected-actions">
        <Button
          type="text"
          size="small"
          shape="circle"
          className="source-material-toggle"
          icon={<RightOutlined />}
          aria-label={t(dimensionsOpen ? 'collapseMaterialDimensions' : 'expandMaterialDimensions')}
          title={t(dimensionsOpen ? 'collapseMaterialDimensions' : 'expandMaterialDimensions')}
          aria-expanded={dimensionsOpen}
          aria-controls={dimensionsId}
          onClick={() => setDimensionsOpen((open) => !open)}
        />
        <span className="source-material-price-summary">
          <MaterialPrices option={option} />
        </span>
        <MaterialPreviewButton option={option} preview={preview} />
      </div>
      <div id={dimensionsId} hidden={!dimensionsOpen} className="source-material-dimensions">
        {dimensionsOpen && (
          <>
            <MaterialDimensions option={option} />
            <Link
              href={{ pathname: '/admin/materials', query: { q: option.material.name } }}
              target="_blank"
              rel="noopener noreferrer"
              className="source-material-detail-link"
            >
              <ExportOutlined />
              {t('viewMaterialDetails')}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

// Only intentional hover or click previews fetch images; cached blob URLs stay local to this page.
export function useMaterialImagePreview() {
  const t = useTranslations('productSources');
  const [preview, setPreview] = useState<{ option: MaterialOption; index: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const cache = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, Promise<string>>());
  const controllers = useRef(new Set<AbortController>());
  const request = useRef(0);

  useEffect(() => {
    const images = cache.current;
    const requests = controllers.current;
    const requestCounter = request;
    return () => {
      requestCounter.current++;
      requests.forEach((controller) => controller.abort());
      images.forEach((url) => URL.revokeObjectURL(url));
      images.clear();
    };
  }, []);

  async function show(option: MaterialOption, index = 0, modal = false) {
    const image = materialImages(option)[index];
    if (!image) return;
    const current = ++request.current;
    setPreview({ option, index });
    setModalOpen(modal);
    setError(false);
    setSrc(cache.current.get(image.url) ?? null);
    if (cache.current.has(image.url)) return;

    try {
      let download = pending.current.get(image.url);
      if (!download) {
        const controller = new AbortController();
        controllers.current.add(controller);
        download = (async () => {
          try {
            const response = await fetch(image.url, { signal: controller.signal });
            if (!response.ok) throw new Error('Image download failed');
            const blob = await response.blob();
            if (controller.signal.aborted) throw new Error('Image download cancelled');
            const url = URL.createObjectURL(blob);
            cache.current.set(image.url, url);
            return url;
          } finally {
            controllers.current.delete(controller);
            pending.current.delete(image.url);
          }
        })();
        pending.current.set(image.url, download);
      }
      const url = await download;
      if (request.current === current) setSrc(url);
    } catch {
      if (request.current === current) setError(true);
    }
  }

  const images = preview ? materialImages(preview.option) : [];
  const content = preview && (
    <>
      <p className="source-material-preview-batch">{preview.option.entry.batch.name}</p>
      <div className="source-material-preview-image">
        {error ? (
          <Alert
            type="error"
            showIcon
            message={t('materialImageError')}
            action={
              <Button onClick={() => void show(preview.option, preview.index, modalOpen)}>
                {t('retryImage')}
              </Button>
            }
          />
        ) : src ? (
          <NextImage
            unoptimized
            src={src}
            alt={preview.option.material.name}
            width={600}
            height={480}
            onError={() => setError(true)}
          />
        ) : (
          <Spin />
        )}
      </div>
      {images.length > 1 && (
        <div className="source-material-preview-controls">
          <Button
            type="text"
            shape="circle"
            size="small"
            icon={<LeftOutlined />}
            aria-label={t('previousImage')}
            disabled={preview.index === 0}
            onClick={() => void show(preview.option, preview.index - 1, modalOpen)}
          />
          <span>
            {preview.index + 1} / {images.length}
          </span>
          <Button
            type="text"
            shape="circle"
            size="small"
            icon={<RightOutlined />}
            aria-label={t('nextImage')}
            disabled={preview.index === images.length - 1}
            onClick={() => void show(preview.option, preview.index + 1, modalOpen)}
          />
        </div>
      )}
    </>
  );
  return {
    activeId: preview?.option.entry.id,
    show: (option: MaterialOption) => void show(option, 0, true),
    showHover: (option: MaterialOption) => void show(option),
    content,
    viewer: (
      <Modal
        title={preview?.option.material.name || t('viewImages')}
        open={modalOpen}
        width={640}
        footer={null}
        onCancel={() => {
          request.current++;
          setModalOpen(false);
          setPreview(null);
          setSrc(null);
        }}
      >
        {modalOpen && content}
      </Modal>
    ),
  };
}
