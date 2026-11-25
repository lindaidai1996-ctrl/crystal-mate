'use client';

import { Select, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { ImagePicker } from '@/components/image-picker';
import { LoadingImage } from '@/components/loadingImage';
import type { MaterialBatchEntry, ProductImage } from '@/lib/client-types';
import { imageThumbnailUrl } from '@/lib/image-storage';
import { ImageHoverPreview } from './imageHoverPreview';

const maxImages = 12;

export function MaterialMasterImages({
  images,
  entries,
  disabled,
  onChange,
  onUploadingChange,
}: {
  images: ProductImage[];
  entries: MaterialBatchEntry[];
  disabled: boolean;
  onChange: (images: ProductImage[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations('materialEditor');
  const defaultEntry = images.length ? undefined : entries.find((entry) => entry.images.length > 0);
  const selected = new Set(images.map((image) => image.objectKey));
  const batchOptions = new Map<string, { value: string; label: string; image: ProductImage }>();
  for (const entry of entries) {
    for (const [index, image] of entry.images.entries()) {
      if (batchOptions.has(image.objectKey)) continue;
      batchOptions.set(image.objectKey, {
        value: image.objectKey,
        label: t('batchImageOption', { batch: entry.batch.name, position: index + 1 }),
        image,
      });
    }
  }
  const options = [...batchOptions.values()].filter((option) => !selected.has(option.value));

  return (
    <section className="editor-block">
      <h2>{t('masterImages')}</h2>
      {defaultEntry && (
        <Space style={{ marginBottom: 12 }}>
          <ImageHoverPreview
            images={defaultEntry.images.slice(0, 1)}
            name={defaultEntry.batch.name}
            hoverPreview={false}
          />
          <span>{t('defaultCover', { batch: defaultEntry.batch.name })}</span>
        </Space>
      )}
      <ImagePicker
        images={images}
        onChange={onChange}
        onUploadingChange={onUploadingChange}
        disabled={disabled}
        maxImages={maxImages}
      />
      {batchOptions.size > 0 && (
        <Select
          aria-label={t('chooseBatchImage')}
          placeholder={t('chooseBatchImage')}
          style={{ width: '100%', marginTop: 12 }}
          disabled={disabled || images.length >= maxImages || !options.length}
          value={null}
          options={options}
          showSearch
          optionFilterProp="label"
          optionRender={({ data }) => (
            <Space>
              <LoadingImage
                src={imageThumbnailUrl(data.image.url, 128)}
                alt=""
                width={36}
                height={36}
                style={{ objectFit: 'cover', borderRadius: 4 }}
              />
              {data.label}
            </Space>
          )}
          onSelect={(_, option) =>
            onChange([...images, { ...option.image, position: images.length }])
          }
        />
      )}
    </section>
  );
}
