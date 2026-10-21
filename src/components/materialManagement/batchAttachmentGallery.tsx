'use client';

import { EditOutlined } from '@ant-design/icons';
import { App, Button, Image, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AttachmentImageEditor } from '@/components/imageUpload/attachmentImageEditor';
import { uploadImage } from '@/components/imageUpload/uploadImage';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialBatch, MaterialBatchAttachment } from '@/lib/client-types';

export function BatchAttachmentGallery({
  batch,
  onSaved,
  onUploadingChange,
}: {
  batch: MaterialBatch;
  onSaved: (batch: MaterialBatch) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations('imageUpload');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [editing, setEditing] = useState<MaterialBatchAttachment | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  function finish() {
    setEditing(null);
    setUploadingKey(null);
    onUploadingChange(false);
  }

  async function replaceImage(file: File) {
    if (!editing) return;
    const objectKey = editing.objectKey;
    setEditing(null);
    try {
      const replacement = await uploadImage(file);
      // Preserve metadata and other attachments changed since the page was opened.
      const current = await apiFetch<MaterialBatch>(`/api/material-batches/${batch.id}`);
      if (!current.attachments?.some((item) => item.objectKey === objectKey))
        throw new ClientApiError('NOT_FOUND');
      const saved = await apiFetch<MaterialBatch>(`/api/material-batches/${batch.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: current.name,
          receivedAt: current.receivedAt.slice(0, 10),
          notes: current.notes,
          attachments: current.attachments.map((item) => ({
            objectKey: item.objectKey === objectKey ? replacement.objectKey : item.objectKey,
            fileName: item.objectKey === objectKey ? file.name.slice(0, 255) : item.fileName,
            notes: item.notes,
          })),
        }),
      });
      onSaved(saved);
      message.success(common('saved'));
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      finish();
    }
  }

  return (
    <>
      <Image.PreviewGroup>
        <div className="batch-detail-attachment-list">
          {batch.attachments?.map((attachment) => (
            <div className="batch-detail-attachment" key={attachment.objectKey}>
              <Image src={attachment.url} alt={attachment.fileName} width={110} height={110} />
              <div className="batch-detail-attachment-content">
                {attachment.notes?.trim() && <p>{attachment.notes}</p>}
                <Tooltip title={t('editImage')}>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    disabled={uploadingKey !== null}
                    loading={uploadingKey === attachment.objectKey && !editing}
                    aria-label={`${t('editImage')} ${attachment.fileName}`}
                    onClick={() => {
                      setEditing(attachment);
                      setUploadingKey(attachment.objectKey);
                      onUploadingChange(true);
                    }}
                  >
                    {t('editImage')}
                  </Button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      </Image.PreviewGroup>
      {editing && (
        <AttachmentImageEditor
          key={editing.objectKey}
          url={editing.url}
          fileName={editing.fileName}
          onCancel={finish}
          onConfirm={(file) => void replaceImage(file)}
        />
      )}
    </>
  );
}
