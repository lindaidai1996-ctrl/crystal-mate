'use client';

import { LeftOutlined, PictureOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Image, Popover } from 'antd';
import { LoadingImage } from '@/components/loadingImage';
import { FramedImage } from '@/components/framedImage';
import type { FramedImage as ImageFramingFields } from '@/lib/image-framing';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { imageThumbnailUrl } from '@/lib/image-storage';

type PreviewImage = { objectKey: string; url: string; fileName?: string } & ImageFramingFields;

export function ImageHoverPreview({
  images,
  name,
  coverObjectKey,
  hoverPreview = true,
  thumbnailSize = 128,
}: {
  images: PreviewImage[];
  name: string;
  coverObjectKey?: string | null;
  hoverPreview?: boolean;
  thumbnailSize?: 128 | 640 | 'original';
}) {
  const t = useTranslations('editor');
  const [current, setCurrent] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const image = images[current] ?? images[0];

  if (!image)
    return (
      <span className="product-thumb product-thumb-empty" aria-hidden="true">
        <PictureOutlined />
      </span>
    );

  // A list cover stays fixed even while the user browses other images in the preview.
  const thumbnail =
    coverObjectKey === undefined
      ? images[0]
      : (images.find((item) => item.objectKey === coverObjectKey) ?? images[0]);
  const thumbnailButton = (
    <button
      type="button"
      className="material-image-thumb-button"
      aria-label={t('previewImage')}
      onClick={() => setPreviewOpen(true)}
    >
      <span className="product-thumb">
        <FramedImage
          src={
            thumbnailSize === 'original'
              ? thumbnail.url
              : imageThumbnailUrl(thumbnail.url, thumbnailSize)
          }
          framing={thumbnail.framing}
        />
      </span>
    </button>
  );

  return (
    <Image.PreviewGroup
      items={images.map((item) => ({ src: item.url, alt: item.fileName || name }))}
      preview={{
        visible: previewOpen,
        current,
        onVisibleChange: setPreviewOpen,
        onChange: setCurrent,
      }}
    >
      {hoverPreview ? (
        <Popover
          trigger="hover"
          content={
            <div className="material-image-preview">
              <button
                type="button"
                className="material-image-preview-open"
                onClick={() => setPreviewOpen(true)}
                aria-label={t('previewImage')}
              >
                <LoadingImage
                  unoptimized
                  width={280}
                  height={280}
                  src={imageThumbnailUrl(image.url, 640)}
                  alt={image.fileName || name}
                />
              </button>
              {images.length > 1 && (
                <div className="material-image-preview-controls">
                  <Button
                    type="text"
                    size="small"
                    icon={<LeftOutlined />}
                    aria-label={t('previousImage')}
                    onClick={() =>
                      setCurrent((index) => (index - 1 + images.length) % images.length)
                    }
                  />
                  <span>{`${current + 1} / ${images.length}`}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<RightOutlined />}
                    aria-label={t('nextImage')}
                    onClick={() => setCurrent((index) => (index + 1) % images.length)}
                  />
                </div>
              )}
            </div>
          }
        >
          {thumbnailButton}
        </Popover>
      ) : (
        thumbnailButton
      )}
    </Image.PreviewGroup>
  );
}
