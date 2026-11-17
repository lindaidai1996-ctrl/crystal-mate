'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  Tag,
  TreeSelect,
} from 'antd';
import { DownOutlined, PictureOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { ResponsiveDrawer } from '@/components/responsive/responsiveDialog';
import { FramedImage } from '@/components/framedImage';
import { ImagePreviewGroup } from '@/components/imagePreviewGroup';
import { Sensitive } from '@/components/privacyMode';
import { apiFetch } from '@/lib/client-api';
import type {
  DistributorPage,
  Material,
  MaterialCategory,
  Product,
  ProductImage,
  Tag as CatalogTag,
} from '@/lib/client-types';
import { imageThumbnailUrl } from '@/lib/image-storage';
import { formatAmount } from '@/lib/format-money';
import {
  pickerFiltersSchema,
  selectionId,
  type PickerFilters,
  type PickerKind,
  type PickerPage,
  type PickerSelection,
} from '@/lib/diy-picker/contracts';
import pickerStyles from './diyPicker.module.css';

export type PickerPreferences = Partial<PickerFilters>;

function Picture({ images, name }: { images: ProductImage[]; name: string }) {
  const t = useTranslations('diyPicker');
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  if (!images.length)
    return (
      <div className={pickerStyles.emptyPicture}>
        <PictureOutlined />
        <span>{t('noImage')}</span>
      </div>
    );
  return (
    <ImagePreviewGroup
      items={images.map((image) => ({ src: image.url, alt: name }))}
      preview={{
        visible: open,
        current,
        onVisibleChange: setOpen,
        onChange: setCurrent,
        zIndex: 1400,
      }}
    >
      <button
        type="button"
        className={pickerStyles.picture}
        aria-label={t('preview', { name })}
        title={t('viewImages', { count: images.length })}
        onClick={() => {
          setCurrent(0);
          setOpen(true);
        }}
      >
        <FramedImage
          src={imageThumbnailUrl(images[0].url, 640)}
          framing={images[0].framing}
          alt={name}
        />
        <span className={pickerStyles.zoom} aria-hidden="true">
          <PictureOutlined />
          {images.length}
        </span>
      </button>
    </ImagePreviewGroup>
  );
}

function dimensions(
  item: {
    lengthMm: string | number | null;
    widthMm: string | number | null;
    heightMm: string | number | null;
  } | null,
) {
  return item && [item.lengthMm, item.widthMm, item.heightMm].some((value) => value !== null)
    ? [item.lengthMm, item.widthMm, item.heightMm]
        .map((value) => (value === null ? '—' : Number(value)))
        .join(' × ') + ' mm'
    : '—';
}

function CategoryFilter({
  categories,
  value,
  onChange,
  label,
}: {
  categories: MaterialCategory[];
  value?: string;
  onChange: (id?: string) => void;
  label: string;
}) {
  return (
    <TreeSelect
      aria-label={label}
      placeholder={label}
      allowClear
      showSearch
      treeNodeFilterProp="title"
      value={value}
      onChange={onChange}
      treeDataSimpleMode
      treeData={categories.map((category) => ({
        id: category.id,
        pId: category.parentId ?? undefined,
        value: category.id,
        title: category.name,
      }))}
    />
  );
}

export function DiyPicker({
  kind,
  single,
  preferences,
  onPreferences,
  existingIds,
  excludeProductId,
  distributors,
  onClose,
  onConfirm,
}: {
  kind: PickerKind;
  single: boolean;
  preferences: PickerPreferences;
  onPreferences: (next: PickerPreferences) => void;
  existingIds: string[];
  excludeProductId?: string;
  distributors: DistributorPage['items'];
  onClose: () => void;
  onConfirm: (selections: PickerSelection[]) => void;
}) {
  const t = useTranslations('diyPicker');
  const sourceT = useTranslations('productSources');
  const locale = useLocale();
  const [selected, setSelected] = useState<PickerSelection[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [tags, setTags] = useState<CatalogTag[]>([]);
  const [metadataError, setMetadataError] = useState(false);
  const [retryMetadata, setRetryMetadata] = useState(0);
  const [result, setResult] = useState<PickerPage<Material | Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const requestSequence = useRef(0);
  const [responseQuery, setResponseQuery] = useState<string | null>(null);
  const filterResult = pickerFiltersSchema.safeParse({ ...preferences, excludeProductId });
  const valid = filterResult.success;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...preferences, excludeProductId })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  const update = (next: PickerPreferences) => onPreferences({ ...preferences, ...next, page: 1 });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      kind === 'materials'
        ? apiFetch<MaterialCategory[]>('/api/material-categories')
        : Promise.resolve([]),
      apiFetch<CatalogTag[]>('/api/tags'),
    ])
      .then(([nextCategories, nextTags]) => {
        if (cancelled) return;
        setCategories(nextCategories);
        setTags(nextTags);
        setMetadataError(false);
      })
      .catch(() => {
        if (!cancelled) setMetadataError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, retryMetadata]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!valid) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(false);
      apiFetch<PickerPage<Material | Product>>(`/api/diy-picker/${kind}?${query}`, {
        signal: controller.signal,
      })
        .then((page) => {
          if (sequence !== requestSequence.current) return;
          setResult(page);
          setResponseQuery(query);
          setLoading(false);
        })
        .catch(() => {
          if (controller.signal.aborted || sequence !== requestSequence.current) return;
          setResponseQuery(query);
          setError(true);
          setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [kind, query, retry, valid]);

  const choose = (selection: PickerSelection) => {
    const id = selectionId(selection);
    setSelected((current) =>
      current.some((item) => selectionId(item) === id)
        ? current.filter((item) => selectionId(item) !== id)
        : single
          ? [selection]
          : [...current, selection],
    );
  };
  const checked = (id: string) => selected.some((item) => selectionId(item) === id);
  const stock = (quantity: number | null, unit: string) => (
    <span className={pickerStyles.stock} data-empty={quantity === 0}>
      {quantity === null ? t('unknownStock') : t('stockQuantity', { quantity, unit })}
    </span>
  );
  const marker = (id: string) => (existingIds.includes(id) ? <Tag>{t('alreadyUsed')}</Tag> : null);
  const footer = (
    <div className={pickerStyles.footer}>
      <div className={pickerStyles.selectedList}>
        <strong aria-live="polite">{t('selected', { count: selected.length })}</strong>
        {selected.map((item) => (
          <Tag key={selectionId(item)} closable onClose={() => choose(item)}>
            {item.kind === 'materials'
              ? `${item.material.name} · ${item.entry.batch.name}`
              : `${item.product.name} · ${item.product.code}`}
          </Tag>
        ))}
      </div>
      <div className={pickerStyles.actions}>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button type="primary" disabled={!selected.length} onClick={() => onConfirm(selected)}>
          {t(single ? 'replace' : 'addSelected')}
        </Button>
      </div>
    </div>
  );

  return (
    <ResponsiveDrawer
      open
      onClose={onClose}
      title={t(kind === 'materials' ? 'materialsTitle' : 'cabochonsTitle')}
      width={1180}
      zIndex={1200}
      rootClassName={pickerStyles.drawer}
      footer={footer}
    >
      <div className={pickerStyles.toolbar}>
        <Segmented
          block
          value={preferences.source ?? 'all'}
          options={[
            { value: 'all', label: t('all') },
            { value: 'recent', label: t('recent') },
          ]}
          onChange={(source) => update({ source: source as 'all' | 'recent' })}
        />
        <Input
          aria-label={t('search')}
          prefix={<SearchOutlined />}
          placeholder={t(kind === 'materials' ? 'searchMaterials' : 'searchCabochons')}
          value={preferences.q ?? ''}
          maxLength={120}
          allowClear
          onChange={(event) => update({ q: event.target.value })}
        />
        <Button
          className={pickerStyles.filterToggle}
          aria-expanded={showFilters}
          onClick={() => setShowFilters((value) => !value)}
        >
          {t('filters')}
        </Button>
      </div>
      <div className={pickerStyles.filters} data-open={showFilters}>
        {kind === 'materials' && (
          <CategoryFilter
            categories={categories}
            value={preferences.categoryId}
            label={t('category')}
            onChange={(categoryId) => update({ categoryId })}
          />
        )}
        <Select
          aria-label={t('tag')}
          placeholder={t('tag')}
          allowClear
          showSearch
          optionFilterProp="label"
          value={preferences.tagId}
          options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
          onChange={(tagId) => update({ tagId })}
        />
        {kind === 'materials' && (
          <Select
            aria-label={t('distributor')}
            placeholder={t('distributor')}
            allowClear
            showSearch
            optionFilterProp="label"
            value={preferences.distributorId}
            options={distributors.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(distributorId) => update({ distributorId })}
          />
        )}
        <Select
          aria-label={t('stock')}
          value={preferences.stock ?? 'all'}
          options={[
            { value: 'all', label: t('allStock') },
            { value: 'available', label: t('availableStock') },
          ]}
          onChange={(value) => update({ stock: value })}
        />
        {(['length', 'width', 'height'] as const).map((field) => (
          <fieldset className={pickerStyles.range} key={field}>
            <legend>{t(field)} (mm)</legend>
            <InputNumber
              aria-label={t('minimum', { dimension: t(field) })}
              min={0}
              max={100000}
              placeholder={t('min')}
              value={preferences[`${field}Min`]}
              onChange={(value) => update({ [`${field}Min`]: value ?? undefined })}
            />
            <span>–</span>
            <InputNumber
              aria-label={t('maximum', { dimension: t(field) })}
              min={0}
              max={100000}
              placeholder={t('max')}
              value={preferences[`${field}Max`]}
              onChange={(value) => update({ [`${field}Max`]: value ?? undefined })}
            />
          </fieldset>
        ))}
        <Button
          type="link"
          onClick={() => onPreferences({ source: preferences.source ?? 'all', page: 1 })}
        >
          {t('resetFilters')}
        </Button>
      </div>
      {metadataError && (
        <Alert
          type="warning"
          message={t('metadataError')}
          action={
            <Button onClick={() => setRetryMetadata((value) => value + 1)}>{t('retry')}</Button>
          }
        />
      )}
      {!valid ? (
        <Alert type="warning" message={t('invalidRange')} />
      ) : error && responseQuery === query ? (
        <Alert
          type="error"
          message={t('loadError')}
          action={<Button onClick={() => setRetry((value) => value + 1)}>{t('retry')}</Button>}
        />
      ) : loading || responseQuery !== query ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : result?.items.length ? (
        <>
          <div className={pickerStyles.resultCount}>{t('results', { count: result.total })}</div>
          <div className={pickerStyles.grid} data-kind={kind}>
            {result.items.map((item) => {
              if (kind === 'cabochons') {
                const product = item as Product;
                return (
                  <article
                    key={product.id}
                    className={pickerStyles.card}
                    data-selected={checked(product.id)}
                  >
                    <Picture images={product.images} name={product.name} />
                    <div className={pickerStyles.cardBody}>
                      <strong>{product.name}</strong>
                      <span className={pickerStyles.secondary}>{product.code}</span>
                      <span>{dimensions(product.measurement)}</span>
                      {stock(product.stock, sourceT('BEAD'))}
                      {marker(product.id)}
                      <Checkbox
                        checked={checked(product.id)}
                        onChange={() => choose({ kind: 'cabochons', product })}
                      >
                        {t('selectItem')}
                      </Checkbox>
                    </div>
                  </article>
                );
              }
              const material = item as Material;
              const entries = material.batchEntries;
              const isExpanded = expanded.includes(material.id) || entries.length === 1;
              const imageEntry = entries.find((entry) => entry.images.length);
              const images = imageEntry?.images.length ? imageEntry.images : material.images;
              return (
                <article
                  key={material.id}
                  className={pickerStyles.card}
                  data-selected={entries.some((entry) => checked(entry.id))}
                >
                  <div className={pickerStyles.materialHeader}>
                    <Picture images={images} name={material.name} />
                    <div className={pickerStyles.materialInfo}>
                      <strong>{material.name}</strong>
                      <span className={pickerStyles.secondary}>{material.category.name}</span>
                      {entries.length > 1 && (
                        <Button
                          type="text"
                          className={pickerStyles.batchToggle}
                          icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
                          iconPosition="end"
                          aria-label={t(isExpanded ? 'collapseBatches' : 'chooseBatch', {
                            count: entries.length,
                          })}
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setExpanded((current) =>
                              isExpanded
                                ? current.filter((id) => id !== material.id)
                                : [...current, material.id],
                            )
                          }
                        >
                          {t('batchCount', { count: entries.length })}
                        </Button>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className={pickerStyles.batches}>
                      {entries.map((entry) => (
                        <div
                          className={pickerStyles.batch}
                          key={entry.id}
                          data-selected={checked(entry.id)}
                        >
                          {entries.length > 1 && (
                            <Picture
                              images={entry.images.length ? entry.images : material.images}
                              name={`${material.name} · ${entry.batch.name}`}
                            />
                          )}
                          <div className={pickerStyles.batchInfo}>
                            <strong>{entry.batch.name}</strong>
                            <div className={pickerStyles.batchMeta}>
                              <span>{entry.distributor.name}</span>
                              <span>
                                {new Intl.DateTimeFormat(locale, {
                                  timeZone: 'Asia/Shanghai',
                                }).format(new Date(entry.batch.receivedAt))}
                              </span>
                            </div>
                            <span className={pickerStyles.secondary}>{dimensions(entry)}</span>
                          </div>
                          <div className={pickerStyles.batchSummary}>
                            {stock(entry.remainingQty, sourceT(material.unit))}
                            <Sensitive>
                              <span>
                                {t('purchaseUnitPrice')}:{' '}
                                {entry.purchaseUnitPrice === null
                                  ? '—'
                                  : `¥${formatAmount(entry.purchaseUnitPrice)}/${sourceT(material.unit)}`}
                              </span>
                            </Sensitive>
                          </div>
                          <div className={pickerStyles.batchSelection}>
                            <Checkbox
                              checked={checked(entry.id)}
                              onChange={() => choose({ kind: 'materials', material, entry })}
                            >
                              {t('selectBatch')}
                            </Checkbox>
                            {marker(entry.id)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <Pagination
            className={pickerStyles.pagination}
            current={result.page}
            pageSize={result.pageSize}
            total={result.total}
            showSizeChanger={false}
            onChange={(page) => onPreferences({ ...preferences, page })}
          />
        </>
      ) : (
        <Empty description={t(preferences.source === 'recent' ? 'emptyRecent' : 'emptyResults')} />
      )}
    </ResponsiveDrawer>
  );
}
