'use client';

import { LeftOutlined, PictureOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Image, Popover } from 'antd';
import NextImage from 'next/image';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

type PreviewImage = { objectKey: string; url: string; fileName?: string };

export function ImageHoverPreview({ images, name }: { images: PreviewImage[]; name: string }) {
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
              <NextImage
                unoptimized
                width={280}
                height={280}
                src={image.url}
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
                  onClick={() => setCurrent((index) => (index - 1 + images.length) % images.length)}
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
        <button
          type="button"
          className="material-image-thumb-button"
          aria-label={t('previewImage')}
          onClick={() => setPreviewOpen(true)}
        >
          <NextImage
            unoptimized
            width={44}
            height={44}
            className="product-thumb"
            src={image.url}
            alt=""
          />
        </button>
      </Popover>
    </Image.PreviewGroup>
  );
}
