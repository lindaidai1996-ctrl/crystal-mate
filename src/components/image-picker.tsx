'use client';

import { ImagePreviewGroup } from '@/components/imagePreviewGroup';

import {
  BorderOuterOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  PlusOutlined,
  ZoomInOutlined,
} from '@ant-design/icons';
import { App, Button, Spin, Upload, type UploadFile, Tooltip, theme } from 'antd';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ProductImage } from '@/lib/client-types';
import { imageThumbnailUrl, type ImageUploadPurpose } from '@/lib/image-storage';
import { ImageUploadChoiceDialog } from './imageUpload/imageUploadChoiceDialog';
import { AttachmentImageEditor } from './imageUpload/attachmentImageEditor';
import { uploadImage } from './imageUpload/uploadImage';
import { useImageFilePicker } from './imageUpload/useImageFilePicker';
import { FramedImage } from './framedImage';
import { ImageFramingDialog } from './imageUpload/imageFramingDialog';
import pickerStyles from './imagePicker.module.css';

type ImageDrag = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  targetKey: string | null;
};

export function ImagePicker({
  images,
  onChange,
  onUploadingChange,
  disabled = false,
  maxImages = 12,
  purpose = 'catalog',
}: {
  images: ProductImage[];
  onChange: (images: ProductImage[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  maxImages?: number;
  purpose?: ImageUploadPurpose;
}) {
  const t = useTranslations('editor');
  const imageT = useTranslations('imageUpload');
  const common = useTranslations('common');
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<ProductImage | null>(null);
  const [framingImage, setFramingImage] = useState<ProductImage | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const dragSession = useRef<{
    key: string;
    pointerId: number;
    startX: number;
    startY: number;
    bounds: DOMRect;
    active: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<ImageDrag | null>(null);
  const busy = uploading || disabled;
  const { openFilePicker, filePicker } = useImageFilePicker({
    disabled: busy || images.length >= maxImages,
    onSelect: selectFiles,
  });

  function changeUploading(value: boolean) {
    setUploading(value);
    onUploadingChange?.(value);
  }

  async function replaceImage(file: File) {
    if (!editing) return;
    const objectKey = editing.objectKey;
    setEditing(null);
    try {
      const replacement = await uploadImage(file, purpose);
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
  const fileList: UploadFile[] = images.map((image, index) => ({
    uid: image.objectKey,
    name: t('imageNumber', { number: index + 1 }),
    status: 'done',
    url: image.url,
    thumbUrl: imageThumbnailUrl(image.url),
  }));

  function selectFiles(files: File[]) {
    if (!files.length || busy || pendingFiles) return;
    const selected = files.slice(0, maxImages - images.length);
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
          added.push(await uploadImage(file, purpose));
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
    if (busy || from === to || from < 0 || to < 0 || from >= images.length || to >= images.length)
      return;
    const copy = [...images];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    onChange(copy.map((image, position) => ({ ...image, position })));
  }

  function dropTarget(x: number, y: number) {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('.image-picker-sortable');
    return target && pickerRef.current?.contains(target) ? (target.dataset.imageKey ?? null) : null;
  }

  function cancelDrag() {
    dragSession.current = null;
    setDrag(null);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, key: string) {
    if (busy || images.length < 2 || !event.isPrimary || event.button !== 0 || dragSession.current)
      return;
    const card = event.currentTarget.closest('.image-picker-sortable');
    const bounds = card?.querySelector('.ant-upload-list-item')?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragSession.current = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      bounds,
      active: false,
    };
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (busy) {
      cancelDrag();
      return;
    }
    event.preventDefault();
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.active && Math.hypot(dx, dy) < 6) return;
    session.active = true;
    setDrag({
      key: session.key,
      x: session.bounds.left + dx,
      y: session.bounds.top + dy,
      width: session.bounds.width,
      height: session.bounds.height,
      targetKey: dropTarget(event.clientX, event.clientY),
    });
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const targetKey = dropTarget(event.clientX, event.clientY);
    cancelDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (session.active) {
      reorder(
        images.findIndex((image) => image.objectKey === session.key),
        images.findIndex((image) => image.objectKey === targetKey),
      );
    }
  }

  const draggedImage = drag && images.find((image) => image.objectKey === drag.key);

  return (
    <div ref={pickerRef}>
      {filePicker}
      <Upload
        className="image-picker-upload"
        listType="picture-card"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy}
        openFileDialogOnClick={false}
        hasControlInside
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
        itemRender={(_originNode, file, _files, actions) => (
          <div
            className="image-picker-sortable"
            data-image-key={file.uid}
            data-dragging={drag?.key === file.uid || undefined}
            data-drop-target={(drag?.targetKey === file.uid && drag.key !== file.uid) || undefined}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="ant-upload-list-item ant-upload-list-item-done">
              <button
                type="button"
                className="ant-upload-list-item-thumbnail"
                aria-label={`${t('previewImage')} ${file.name}`}
                onClick={actions.preview}
              >
                <FramedImage
                  src={file.thumbUrl || file.url!}
                  alt={file.name}
                  framing={images.find((image) => image.objectKey === file.uid)?.framing}
                />
              </button>
              {images[0]?.objectKey === file.uid && (
                <span className={pickerStyles.coverBadge}>{imageT('coverBadge')}</span>
              )}
              <span className="ant-upload-list-item-actions">
                <Button
                  type="text"
                  size="small"
                  icon={<ZoomInOutlined />}
                  aria-label={`${t('previewImage')} ${file.name}`}
                  onClick={actions.preview}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={busy}
                  aria-label={`${common('delete')} ${file.name}`}
                  onClick={actions.remove}
                />
              </span>
            </div>
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
            <button
              type="button"
              className="image-picker-drag-handle"
              disabled={busy || images.length < 2}
              aria-label={`${file.name}，${t('reorderImages')}`}
              onPointerDown={(event) => startDrag(event, file.uid)}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelDrag();
                  return;
                }
                if (dragSession.current) return;
                const index = images.findIndex((image) => image.objectKey === file.uid);
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  reorder(index, index - 1);
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  reorder(index, index + 1);
                }
              }}
            >
              <HolderOutlined />
              <span>{t('dragToReorder')}</span>
            </button>
            <Button
              block
              className={pickerStyles.adjustCover}
              icon={<BorderOuterOutlined />}
              disabled={busy}
              aria-label={`${imageT('adjustCover')} ${file.name}`}
              onClick={() => {
                const image = images.find((item) => item.objectKey === file.uid);
                if (image) setFramingImage(image);
              }}
            >
              {imageT('adjustCover')}
            </Button>
          </div>
        )}
      >
        {images.length < maxImages && (
          <button
            type="button"
            className={`image-picker-trigger ${pickerStyles.uploadTrigger}`}
            disabled={busy}
            onClick={openFilePicker}
          >
            {uploading ? <Spin size="small" /> : <PlusOutlined />}
            <span>{uploading ? t('uploading') : t('upload')}</span>
          </button>
        )}
      </Upload>
      {drag &&
        draggedImage &&
        !busy &&
        createPortal(
          <div
            className="image-picker-drag-preview"
            aria-hidden="true"
            style={{
              left: drag.x,
              top: drag.y,
              width: drag.width,
              height: drag.height,
              borderColor: token.colorPrimary,
              background: token.colorBgContainer,
              boxShadow: token.boxShadowSecondary,
              zIndex: token.zIndexPopupBase + 1000,
            }}
          >
            <FramedImage src={imageThumbnailUrl(draggedImage.url)} framing={draggedImage.framing} />
          </div>,
          document.body,
        )}
      <ImagePreviewGroup
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
      <div className="helper-text">{imageT('coverPickerHelp')}</div>
      {framingImage && (
        <ImageFramingDialog
          key={framingImage.objectKey}
          url={framingImage.url}
          framing={framingImage.framing}
          onCancel={() => setFramingImage(null)}
          onConfirm={(framing) => {
            onChange(
              images.map((image) =>
                image.objectKey === framingImage.objectKey ? { ...image, framing } : image,
              ),
            );
            setFramingImage(null);
          }}
        />
      )}
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
    </div>
  );
}
