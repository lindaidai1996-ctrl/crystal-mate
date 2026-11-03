'use client';

import { useEffect, useState } from 'react';
import { PictureOutlined } from '@ant-design/icons';
import { Button, Empty, Form, Image, Select, Spin } from 'antd';
import NextImage from 'next/image';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import type { Material, MaterialPage, ProductImage } from '@/lib/client-types';
import importStyles from './materialImageImport.module.css';

export function ExistingMaterialSelect({
  value,
  name,
  disabled,
  onChange,
}: {
  value: string | null;
  name: string;
  disabled: boolean;
  onChange: (material: Material | null) => void;
}) {
  const t = useTranslations('imageImport');
  const common = useTranslations('common');
  const materialsT = useTranslations('materials');
  const editor = useTranslations('materialEditor');
  const batchT = useTranslations('materialBatches');
  const sourcesT = useTranslations('productSources');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<{
    name: string;
    images: ProductImage[];
    current: number;
  } | null>(null);
  const [result, setResult] = useState<{
    query: string;
    items: Material[];
    failed: boolean;
  } | null>(null);
  const query = search.trim();
  const loading = open && !disabled && result?.query !== query;
  const materials = result?.query === query ? result.items : [];
  const failed = result?.query === query && result.failed;

  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ q: query, pageSize: '20' });
        apiFetch<MaterialPage>(`/api/materials?${params}`, { signal: controller.signal })
          .then((page) => {
            if (!controller.signal.aborted) setResult({ query, items: page.items, failed: false });
          })
          .catch(() => {
            if (!controller.signal.aborted) setResult({ query, items: [], failed: true });
          });
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, disabled, query, retry]);

  return (
    <Form.Item
      help={failed ? common('errors.SERVER_ERROR') : t('existingHelp')}
      validateStatus={failed ? 'error' : undefined}
    >
      <Select
        aria-label={t('existingMaterial')}
        showSearch
        filterOption={false}
        allowClear
        disabled={disabled}
        value={value ?? undefined}
        labelRender={({ label }) => label ?? name}
        placeholder={t('searchMaterial')}
        open={open && !disabled}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setSearch('');
        }}
        searchValue={search}
        onSearch={setSearch}
        loading={loading}
        virtual={false}
        listHeight={320}
        classNames={{ popup: { root: importStyles.existingMaterialPopup } }}
        notFoundContent={
          loading ? (
            <Spin size="small" aria-label={common('loading')} />
          ) : failed ? (
            <Button
              type="link"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setResult(null);
                setRetry((count) => count + 1);
              }}
            >
              {common('retry')}
            </Button>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={materialsT('empty')} />
          )
        }
        options={materials.map((material) => ({
          value: material.id,
          label: material.name,
          material,
        }))}
        optionRender={({ data: { material } }) => {
          const entry = material.batchEntries[0];
          const prices = entry ?? material;
          const images = entry?.images.length ? entry.images : material.images;
          return (
            <div className={importStyles.existingMaterialOption}>
              <div
                className={importStyles.existingMaterialImage}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {images.length ? (
                  <button
                    type="button"
                    className="material-image-thumb-button"
                    aria-label={sourcesT('viewMaterialImages', { name: material.name })}
                    onClick={() => setPreview({ name: material.name, images, current: 0 })}
                  >
                    <NextImage
                      unoptimized
                      src={images[0].url}
                      alt=""
                      width={44}
                      height={44}
                      className="product-thumb"
                    />
                  </button>
                ) : (
                  <span
                    className="product-thumb product-thumb-empty"
                    role="img"
                    aria-label={sourcesT('noMaterialImages')}
                  >
                    <PictureOutlined />
                  </span>
                )}
              </div>
              <div className="source-material-details">
                <strong>{material.name}</strong>
                {!!material.aliases.length && (
                  <span>{t('materialAliases', { aliases: material.aliases.join('、') })}</span>
                )}
                {entry && (
                  <span>
                    {entry.batch.name}
                    {entry.distributor?.name && ` · ${entry.distributor.name}`}
                  </span>
                )}
                <span>
                  {batchT('purchaseUnitPrice')}:{' '}
                  {prices.purchaseUnitPrice == null
                    ? '—'
                    : `¥${prices.purchaseUnitPrice}/${editor(material.unit)}`}
                  {' · '}
                  {batchT('gramPrice')}:{' '}
                  {prices.purchaseGramPrice == null
                    ? '—'
                    : `¥${prices.purchaseGramPrice}/${editor('GRAM')}`}
                </span>
              </div>
            </div>
          );
        }}
        onChange={(id) => {
          setSearch('');
          onChange(materials.find((material) => material.id === id) ?? null);
        }}
      />
      <Image.PreviewGroup
        items={preview?.images.map((image) => ({ src: image.url, alt: preview.name })) ?? []}
        preview={{
          visible: preview !== null,
          current: preview?.current ?? 0,
          onVisibleChange: (visible) => {
            if (!visible) setPreview(null);
          },
          onChange: (current) => setPreview((value) => (value ? { ...value, current } : null)),
        }}
      />
    </Form.Item>
  );
}
