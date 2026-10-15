'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Image, Input, Spin, Tooltip } from 'antd';
import { useState } from 'react';
import { apiFetch } from '@/lib/client-api';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import { useTranslations } from 'next-intl';
import { ImageUploadChoiceDialog } from '@/components/imageUpload/imageUploadChoiceDialog';
import { MAX_UPLOAD_BYTES } from '@/components/imageUpload/prepareImages';

type UploadGrant = {
  id: string;
  key: string;
  url: string;
  uploadUrl: string;
  mode: 'local' | 'cos';
};

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
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  async function uploadOne(file: File): Promise<MaterialBatchAttachment> {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size < 1 ||
      file.size > MAX_UPLOAD_BYTES
    )
      throw new Error('INVALID_IMAGE');
    const grant = await apiFetch<UploadGrant>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ type: file.type, size: file.size }),
    });
    if (grant.mode === 'local') {
      const body = new FormData();
      body.append('id', grant.id);
      body.append('file', file);
      await apiFetch(grant.uploadUrl, { method: 'POST', body });
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
    return {
      objectKey: grant.key,
      url: grant.url,
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
          <Tooltip title={t('removeAttachment')}>
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label={`${t('removeAttachment')} ${attachment.fileName}`}
              onClick={() => onChange(attachments.filter((_, itemIndex) => itemIndex !== index))}
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
