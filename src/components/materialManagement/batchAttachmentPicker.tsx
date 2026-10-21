'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Image, Input, Spin, Tooltip } from 'antd';
import { useState } from 'react';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import { useTranslations } from 'next-intl';
import { ImageUploadChoiceDialog } from '@/components/imageUpload/imageUploadChoiceDialog';
import { AttachmentImageEditor } from '@/components/imageUpload/attachmentImageEditor';
import { uploadImage } from '@/components/imageUpload/uploadImage';

export function BatchAttachmentPicker({
  attachments,
  onChange,
  onUploadingChange,
}: {
  attachments: MaterialBatchAttachment[];
  onChange: (attachments: MaterialBatchAttachment[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations('materialBatches');
  const imageT = useTranslations('imageUpload');
  const common = useTranslations('common');
  const { message, modal } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<MaterialBatchAttachment | null>(null);

  function finishEditing() {
    setEditing(null);
    setUploading(false);
    onUploadingChange(false);
  }

  async function replaceImage(file: File) {
    if (!editing) return;
    const objectKey = editing.objectKey;
    setEditing(null);
    try {
      const replacement = await uploadOne(file);
      onChange(
        attachments.map((attachment) =>
          attachment.objectKey === objectKey
            ? { ...replacement, notes: attachment.notes, position: attachment.position }
            : attachment,
        ),
      );
    } catch {
      message.error(t('uploadFailed'));
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  async function uploadOne(file: File): Promise<MaterialBatchAttachment> {
    const image = await uploadImage(file);
    return {
      ...image,
      fileName: file.name.slice(0, 255),
      notes: '',
      position: 0,
    };
  }

  function selectFiles(files: FileList | null) {
    if (!files?.length || uploading) return;
    const selected = Array.from(files).slice(0, 12 - attachments.length);
    if (!selected.length) return;
    setUploading(true);
    onUploadingChange(true);
    setPendingFiles(selected);
  }

  async function upload(files: File[]) {
    setPendingFiles(null);
    const added: MaterialBatchAttachment[] = [];
    try {
      for (const file of files) {
        try {
          added.push(await uploadOne(file));
        } catch {
          message.error(t('uploadFailed'));
        }
      }
      if (added.length)
        onChange(
          [...attachments, ...added].map((attachment, position) => ({ ...attachment, position })),
        );
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  return (
    <div className="batch-attachments">
      {editing && (
        <AttachmentImageEditor
          key={editing.objectKey}
          url={editing.url}
          fileName={editing.fileName}
          onCancel={finishEditing}
          onConfirm={(file) => void replaceImage(file)}
        />
      )}
      {pendingFiles && (
        <ImageUploadChoiceDialog
          files={pendingFiles}
          onCancel={() => {
            setPendingFiles(null);
            setUploading(false);
            onUploadingChange(false);
          }}
          onConfirm={(files) => void upload(files)}
        />
      )}
      {attachments.map((attachment, index) => (
        <div className="batch-attachment" key={attachment.objectKey}>
          <Image src={attachment.url} alt={attachment.fileName} width={76} height={76} />
          <div className="batch-attachment-fields">
            <Tooltip title={attachment.fileName}>
              <span className="batch-attachment-name">{attachment.fileName}</span>
            </Tooltip>
            <Input.TextArea
              aria-label={`${attachment.fileName} ${t('attachmentNotes')}`}
              placeholder={t('attachmentNotes')}
              value={attachment.notes}
              disabled={uploading}
              maxLength={1000}
              autoSize={{ minRows: 1, maxRows: 3 }}
              onChange={(event) =>
                onChange(
                  attachments.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, notes: event.target.value } : item,
                  ),
                )
              }
            />
          </div>
          <Tooltip title={imageT('editImage')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              disabled={uploading}
              aria-label={`${imageT('editImage')} ${attachment.fileName}`}
              onClick={() => {
                setUploading(true);
                onUploadingChange(true);
                setEditing(attachment);
              }}
            />
          </Tooltip>
          <Tooltip title={t('removeAttachment')}>
            <Button
              type="text"
              danger
              disabled={uploading}
              icon={<DeleteOutlined />}
              aria-label={`${t('removeAttachment')} ${attachment.fileName}`}
              onClick={async () => {
                const confirmed = await modal.confirm({
                  title: imageT('deleteConfirm'),
                  content: attachment.fileName,
                  okText: common('delete'),
                  cancelText: common('cancel'),
                  okButtonProps: { danger: true },
                  autoFocusButton: 'cancel',
                });
                if (!confirmed) return;
                onChange(
                  attachments
                    .filter((item) => item.objectKey !== attachment.objectKey)
                    .map((item, position) => ({ ...item, position })),
                );
              }}
            />
          </Tooltip>
        </div>
      ))}
      {attachments.length < 12 && (
        <label className="batch-attachment-upload">
          {uploading ? <Spin size="small" /> : <PlusOutlined />}
          <span>{uploading ? t('uploading') : t('uploadAttachment')}</span>
          <input
            type="file"
            aria-label={t('uploadAttachment')}
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading}
            onChange={(event) => {
              selectFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      )}
      <span className="batch-attachment-hint">{t('attachmentHelp')}</span>
    </div>
  );
}
