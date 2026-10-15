'use client';

import { HolderOutlined, PlusOutlined, ZoomInOutlined } from '@ant-design/icons';
import { App, Image, Spin, Upload, type UploadFile, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { apiFetch } from '@/lib/client-api';
import type { ProductImage } from '@/lib/client-types';
import { ImageUploadChoiceDialog } from './imageUpload/imageUploadChoiceDialog';
import { MAX_UPLOAD_BYTES } from './imageUpload/prepareImages';

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
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const draggingKey = useRef<string | null>(null);
  const fileList: UploadFile[] = images.map((image, index) => ({
    uid: image.objectKey,
    name: t('imageNumber', { number: index + 1 }),
    status: 'done',
    url: image.url,
    thumbUrl: image.url,
  }));

  async function uploadOne(file: File): Promise<ProductImage> {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > MAX_UPLOAD_BYTES ||
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

  function selectFiles(files: File[]) {
    if (!files.length || uploading || pendingFiles) return;
    const selected = files.slice(0, 12 - images.length);
    if (!selected.length) return;
    setUploading(true);
    setPendingFiles(selected);
  }

  async function upload(files: File[]) {
    setPendingFiles(null);
    const added: ProductImage[] = [];
    try {
      for (const file of files) {
        try {
          added.push(await uploadOne(file));
        } catch {
          message.error(t('uploadFailed'));
        }
      }
      if (added.length)
        onChange([...images, ...added].map((image, position) => ({ ...image, position })));
    } finally {
      setUploading(false);
    }
  }

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const copy = [...images];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    onChange(copy.map((image, position) => ({ ...image, position })));
  }

  return (
    <>
      <Upload
        className="image-picker-upload"
        listType="picture-card"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={uploading || pendingFiles !== null || images.length >= 12}
        fileList={fileList}
        isImageUrl={() => true}
        beforeUpload={(file, files) => {
          if (file === files[0]) selectFiles(files);
          return Upload.LIST_IGNORE;
        }}
        onPreview={(file) => {
          const index = images.findIndex((image) => image.objectKey === file.uid);
          if (index >= 0) setPreviewIndex(index);
        }}
        onRemove={(file) => {
          onChange(
            images
              .filter((image) => image.objectKey !== file.uid)
              .map((image, position) => ({ ...image, position })),
          );
          return false;
        }}
        showUploadList={{ previewIcon: <ZoomInOutlined /> }}
        itemRender={(originNode, file) => (
          <Tooltip title={t('reorderImages')}>
            <div
              className="image-picker-sortable"
              data-image-key={file.uid}
              tabIndex={0}
              aria-label={`${file.name}，${t('reorderImages')}`}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                const index = images.findIndex((image) => image.objectKey === file.uid);
                if (event.key === 'ArrowLeft' && index > 0) {
                  event.preventDefault();
                  reorder(index, index - 1);
                } else if (event.key === 'ArrowRight' && index < images.length - 1) {
                  event.preventDefault();
                  reorder(index, index + 1);
                }
              }}
            >
              {originNode}
              <span
                className="image-picker-drag-handle"
                onPointerDown={(event) => {
                  draggingKey.current = file.uid;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerUp={(event) => {
                  const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>('.image-picker-sortable');
                  const from = images.findIndex((image) => image.objectKey === draggingKey.current);
                  const to = images.findIndex(
                    (image) => image.objectKey === target?.dataset.imageKey,
                  );
                  reorder(from, to);
                  draggingKey.current = null;
                }}
                onPointerCancel={() => {
                  draggingKey.current = null;
                }}
              >
                <HolderOutlined />
              </span>
            </div>
          </Tooltip>
        )}
      >
        {images.length < 12 && (
          <div className="image-picker-trigger">
            {uploading ? <Spin size="small" /> : <PlusOutlined />}
            <span>{uploading ? t('uploading') : t('upload')}</span>
          </div>
        )}
      </Upload>
      <Image.PreviewGroup
        items={images.map((image) => image.url)}
        preview={{
          visible: previewIndex !== null,
          current: previewIndex ?? 0,
          onVisibleChange: (visible) => {
            if (!visible) setPreviewIndex(null);
          },
          onChange: (current) => setPreviewIndex(current),
        }}
      />
      <div className="helper-text">{t('imageHelp')}</div>
      {pendingFiles && (
        <ImageUploadChoiceDialog
          files={pendingFiles}
          askCompression
          onCancel={() => {
            setPendingFiles(null);
            setUploading(false);
          }}
          onConfirm={(files) => void upload(files)}
        />
      )}
    </>
  );
}
