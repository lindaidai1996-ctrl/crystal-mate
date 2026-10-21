'use client';

import {
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  PlusOutlined,
  ZoomInOutlined,
} from '@ant-design/icons';
import { App, Button, Image, Spin, Upload, type UploadFile, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { ProductImage } from '@/lib/client-types';
import { ImageUploadChoiceDialog } from './imageUpload/imageUploadChoiceDialog';
import { AttachmentImageEditor } from './imageUpload/attachmentImageEditor';
import { uploadImage } from './imageUpload/uploadImage';

export function ImagePicker({
  images,
  onChange,
  onUploadingChange,
  disabled = false,
}: {
  images: ProductImage[];
  onChange: (images: ProductImage[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('editor');
  const imageT = useTranslations('imageUpload');
  const common = useTranslations('common');
  const { message, modal } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<ProductImage | null>(null);
  const busy = uploading || disabled;

  function changeUploading(value: boolean) {
    setUploading(value);
    onUploadingChange?.(value);
  }

  async function replaceImage(file: File) {
    if (!editing) return;
    const objectKey = editing.objectKey;
    setEditing(null);
    try {
      const replacement = await uploadImage(file);
      onChange(
        images.map((image) =>
          image.objectKey === objectKey ? { ...replacement, position: image.position } : image,
        ),
      );
    } catch {
      message.error(t('uploadFailed'));
    } finally {
      changeUploading(false);
    }
  }
  const draggingKey = useRef<string | null>(null);
  const fileList: UploadFile[] = images.map((image, index) => ({
    uid: image.objectKey,
    name: t('imageNumber', { number: index + 1 }),
    status: 'done',
    url: image.url,
    thumbUrl: image.url,
  }));

  function selectFiles(files: File[]) {
    if (!files.length || busy || pendingFiles) return;
    const selected = files.slice(0, 12 - images.length);
    if (!selected.length) return;
    changeUploading(true);
    setPendingFiles(selected);
  }

  async function upload(files: File[]) {
    setPendingFiles(null);
    const added: ProductImage[] = [];
    try {
      for (const file of files) {
        try {
          added.push(await uploadImage(file));
        } catch {
          message.error(t('uploadFailed'));
        }
      }
      if (added.length)
        onChange([...images, ...added].map((image, position) => ({ ...image, position })));
    } finally {
      changeUploading(false);
    }
  }

  function reorder(from: number, to: number) {
    if (busy || from === to || from < 0 || to < 0) return;
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
        disabled={busy}
        openFileDialogOnClick={images.length < 12}
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
        onRemove={async (file) => {
          if (busy) return false;
          const confirmed = await modal.confirm({
            title: imageT('deleteConfirm'),
            content: file.name,
            okText: common('delete'),
            cancelText: common('cancel'),
            okButtonProps: { danger: true },
            autoFocusButton: 'cancel',
          });
          if (!confirmed) return false;
          onChange(
            images
              .filter((image) => image.objectKey !== file.uid)
              .map((image, position) => ({ ...image, position })),
          );
          return false;
        }}
        showUploadList={{
          previewIcon: <ZoomInOutlined style={{ color: '#fff' }} />,
          removeIcon: <DeleteOutlined style={{ color: '#fff' }} />,
        }}
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
              <Tooltip title={imageT('editImage')}>
                <Button
                  className="image-picker-edit"
                  size="small"
                  icon={<EditOutlined />}
                  disabled={busy}
                  aria-label={`${imageT('editImage')} ${file.name}`}
                  onClick={() => {
                    const image = images.find((item) => item.objectKey === file.uid);
                    if (!image) return;
                    changeUploading(true);
                    setEditing(image);
                  }}
                />
              </Tooltip>
              <span
                className="image-picker-drag-handle"
                onPointerDown={(event) => {
                  if (busy) return;
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
      {editing && (
        <AttachmentImageEditor
          key={editing.objectKey}
          url={editing.url}
          fileName={editing.objectKey.split('/').at(-1)!}
          onCancel={() => {
            setEditing(null);
            changeUploading(false);
          }}
          onConfirm={(file) => void replaceImage(file)}
        />
      )}
      {pendingFiles && (
        <ImageUploadChoiceDialog
          files={pendingFiles}
          askCompression
          onCancel={() => {
            setPendingFiles(null);
            changeUploading(false);
          }}
          onConfirm={(files) => void upload(files)}
        />
      )}
    </>
  );
}
