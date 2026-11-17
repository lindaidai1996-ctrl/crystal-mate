'use client';

import { useState } from 'react';
import { Button, Empty } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { ImageFramingDialog } from '@/components/imageUpload/imageFramingDialog';
import { FramedImage } from '@/components/framedImage';
import type { ImageFraming } from '@/lib/image-framing';
import { cardAssetUrl, type CardFields, type CardSource } from '@/lib/product-cards/contracts';
import cardStyles from './productCards.module.css';

function CardImageThumbnail({ src, framing }: { src: string; framing: ImageFraming }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const crop = framing.mode === 'cover' ? framing.crop : undefined;
  // The thumbnail is square, but a saved crop can have any aspect ratio.
  const aspect = size && crop ? (size.width * crop.width) / (size.height * crop.height) : 1;
  return (
    <div
      className={cardStyles.imageCrop}
      style={{
        width: `${Math.min(1, aspect) * 100}%`,
        height: `${Math.min(1, 1 / aspect) * 100}%`,
      }}
    >
      <FramedImage
        src={src}
        framing={framing}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth && image.naturalHeight)
            setSize({ width: image.naturalWidth, height: image.naturalHeight });
        }}
      />
    </div>
  );
}

function slotAspect(template: CardFields['template'], count: number, index: number) {
  const width = template === 'editorial' ? 984 : template === 'poetic' ? 864 : 936;
  const height = template === 'poetic' ? 570 : 630;
  if (count === 1) return width / height;
  if (count === 2) {
    const left = template === 'editorial' ? 610 : Math.floor((width - 16) * 0.59);
    return index === 0
      ? left / height
      : (width - left - 16) / (template === 'editorial' ? height - 100 : height);
  }
  const left = Math.floor((width - 16) * 0.64);
  return index === 0 ? left / height : (width - left - 16) / ((height - 16) / 2);
}
export function CardImages({
  images,
  source,
  template,
  onChange,
}: {
  images: CardFields['images'];
  source: CardSource | null;
  template: CardFields['template'];
  onChange: (images: CardFields['images']) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  function url(image: CardFields['images'][number]) {
    return image.assetId
      ? cardAssetUrl(image.assetId)
      : (source?.images.find((entry) => entry.id === image.sourceImageId)?.url ?? '');
  }
  function reorder(index: number, direction: number) {
    const next = [...images];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  return (
    <>
      <div className={cardStyles.selectedImages}>
        {images.map((image, index) => (
          <div key={image.assetId ?? image.sourceImageId} className={cardStyles.selectedImage}>
            <div className={cardStyles.imageFrame}>
              <CardImageThumbnail key={url(image)} src={url(image)} framing={image.framing} />
              <span className={cardStyles.imageNumber}>
                {index === 0 ? '主图' : `辅图 ${index}`}
              </span>
            </div>
            <div className={cardStyles.imageActions}>
              <Button
                type="text"
                size="small"
                disabled={index === 0}
                icon={<ArrowLeftOutlined />}
                aria-label={`向前移动图片 ${index + 1}`}
                onClick={() => reorder(index, -1)}
              />
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                aria-label={`裁切图片 ${index + 1}`}
                onClick={() => setEditing(index)}
              />
              <Button
                type="text"
                size="small"
                disabled={index === images.length - 1}
                icon={<ArrowRightOutlined />}
                aria-label={`向后移动图片 ${index + 1}`}
                onClick={() => reorder(index, 1)}
              />
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={`移除图片 ${index + 1}`}
                onClick={() => onChange(images.filter((_, item) => item !== index))}
              />
            </div>
          </div>
        ))}
      </div>
      {!images.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请至少选择一张商品图" />
      )}
      <p className={cardStyles.help}>
        选择 1–3 张，第一张作为主图。默认完整呈现，裁切只用于这份名片。
      </p>
      <div className={cardStyles.imagePool}>
        {source?.images.map((image) => {
          const selected = images.some((entry) => entry.sourceImageId === image.id);
          return (
            <button
              key={image.id}
              type="button"
              title={selected ? '已选择' : '加入名片'}
              aria-label={`选择商品图 ${source.images.indexOf(image) + 1}`}
              disabled={selected || images.length >= 3}
              onClick={() =>
                onChange([...images, { sourceImageId: image.id, framing: { mode: 'contain' } }])
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="可选商品图" />
              <span>{selected ? '已选' : <PlusOutlined />}</span>
            </button>
          );
        })}
      </div>
      {editing !== null && images[editing] && (
        <ImageFramingDialog
          key={`${editing}-${template}-${images.length}`}
          url={url(images[editing])}
          framing={images[editing].framing}
          aspect={slotAspect(template, images.length, editing)}
          title="调整名片图片"
          fillLabel="按名片比例裁切"
          confirmText="应用图片设置"
          helpText="可保留完整图片，或按当前模板的图片比例裁切。"
          saveHelpText="裁切仅保存到当前名片，不会修改商品图片。"
          onCancel={() => setEditing(null)}
          onConfirm={(framing) => {
            onChange(
              images.map((image, index) => (index === editing ? { ...image, framing } : image)),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
