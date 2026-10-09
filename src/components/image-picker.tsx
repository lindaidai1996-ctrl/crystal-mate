'use client';

import { DeleteOutlined, LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { App, Button, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import Image from 'next/image';
import { apiFetch } from '@/lib/client-api';
import type { ProductImage } from '@/lib/client-types';

type UploadGrant = {
  id: string;
  key: string;
  url: string;
  uploadUrl: string;
  mode: 'local' | 'cos';
};

export function ImagePicker({
  images,
  onChange,
}: {
  images: ProductImage[];
  onChange: (images: ProductImage[]) => void;
}) {
  const t = useTranslations('editor');
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);

  async function uploadOne(file: File): Promise<ProductImage> {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 8 * 1024 * 1024 ||
      file.size === 0
    )
      throw new Error('INVALID_IMAGE');
    const grant = await apiFetch<UploadGrant>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ type: file.type, size: file.size }),
    });
    if (grant.mode === 'local') {
      const data = new FormData();
      data.append('id', grant.id);
      data.append('file', file);
      await apiFetch(grant.uploadUrl, { method: 'POST', body: data });
    } else {
      const response = await fetch(grant.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!response.ok) throw new Error('UPLOAD_FAILED');
      await apiFetch('/api/uploads/confirm', {
        method: 'POST',
        body: JSON.stringify({ id: grant.id }),
      });
    }
    return { objectKey: grant.key, url: grant.url, position: 0 };
  }

  async function upload(files: FileList | null) {
    if (!files?.length || uploading) return;
    const selected = Array.from(files).slice(0, 12 - images.length);
    if (!selected.length) return;
    setUploading(true);
    const added: ProductImage[] = [];
    for (const file of selected) {
      try {
        added.push(await uploadOne(file));
      } catch {
        message.error(t('uploadFailed'));
      }
    }
    if (added.length)
      onChange([...images, ...added].map((image, position) => ({ ...image, position })));
    setUploading(false);
  }

  function move(index: number, direction: -1 | 1) {
    const copy = [...images];
    [copy[index], copy[index + direction]] = [copy[index + direction], copy[index]];
    onChange(copy.map((image, position) => ({ ...image, position })));
  }

  return (
    <>
      <div className="image-grid">
        {images.map((image, index) => (
          <div className="image-item" key={image.objectKey}>
            <Image unoptimized src={image.url} width={200} height={200} alt="" />
            <div className="image-controls">
              <Button
                type="text"
                size="small"
                icon={<LeftOutlined />}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                title={t('moveLeft')}
                aria-label={t('moveLeft')}
              />
              <Button
                type="text"
                size="small"
                icon={<RightOutlined />}
                disabled={index === images.length - 1}
                onClick={() => move(index, 1)}
                title={t('moveRight')}
                aria-label={t('moveRight')}
              />
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  onChange(
                    images
                      .filter((_, i) => i !== index)
                      .map((item, position) => ({ ...item, position })),
                  )
                }
                title={t('removeImage')}
                aria-label={t('removeImage')}
              />
            </div>
          </div>
        ))}
        {images.length < 12 && (
          <label className="upload-trigger">
            {uploading ? <Spin size="small" /> : <PlusOutlined style={{ fontSize: 18 }} />}
            <span>{uploading ? t('uploading') : t('upload')}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={uploading}
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      <div className="helper-text">{t('imageHelp')}</div>
    </>
  );
}
