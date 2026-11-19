'use client';

import { LazyPreviewImage } from '@/components/loadingImage';

import { imageThumbnailUrl } from '@/lib/image-storage';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Alert, Button, Collapse, Input, Spin, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { AttachmentTargets } from '../imageUpload/attachmentTargets';
import { AttachmentRelations, attachmentLocations } from '../imageUpload/attachmentRelations';
import type { AttachmentTarget } from '@/lib/shared-attachment-contracts';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import { useTranslations } from 'next-intl';
import { ImageUploadChoiceDialog } from '@/components/imageUpload/imageUploadChoiceDialog';
import { AttachmentImageEditor } from '@/components/imageUpload/attachmentImageEditor';
import { AttachmentCandidateDialog } from '@/components/imageUpload/attachmentCandidateDialog';
import { attachmentCoverKey, MAX_ATTACHMENTS, type AttachmentOwner } from '@/lib/attachments';
import { uploadImage } from '@/components/imageUpload/uploadImage';
import { useImageFilePicker } from '@/components/imageUpload/useImageFilePicker';

export function BatchAttachmentPicker({
  attachments,
  onChange,
  onUploadingChange,
  owner,
  ownerType,
  coverObjectKey,
  onCoverChange,
  disabled = false,
}: {
  owner?: AttachmentOwner;
  ownerType: AttachmentOwner['type'];
  coverObjectKey?: string | null;
  onCoverChange: (key: string | null) => void;
  disabled?: boolean;
  attachments: MaterialBatchAttachment[];
  onChange: (attachments: MaterialBatchAttachment[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations('materialBatches');
  const imageT = useTranslations('imageUpload');
  const attachmentT = useTranslations('attachments');
  const common = useTranslations('common');
  const sharedT = useTranslations('sharedAttachments');
  const [uploadTargets, setUploadTargets] = useState<AttachmentTarget[]>([]);
  const { message, modal } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const busy = uploading || disabled || choosing;
  const effectiveCover = attachmentCoverKey(attachments, coverObjectKey);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<MaterialBatchAttachment | null>(null);
  const { openFilePicker, filePicker } = useImageFilePicker({
    disabled: busy || attachments.length >= MAX_ATTACHMENTS,
    onSelect: selectFiles,
  });

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
      if (effectiveCover === objectKey) onCoverChange(replacement.objectKey);
      onChange(
        attachments.map((attachment) =>
          attachment.objectKey === objectKey
            ? {
                ...attachment,
                ...replacement,
                source: undefined,
                targets: attachment.targets,
                notes: attachment.notes,
                position: attachment.position,
              }
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
      targets: uploadTargets,
    };
  }

  function selectFiles(files: File[]) {
    if (!files?.length || busy) return;
    const selected = Array.from(files);
    if (selected.length + attachments.length > MAX_ATTACHMENTS) {
      message.warning(attachmentT('limitExceeded', { limit: MAX_ATTACHMENTS }));
      return;
    }
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
      <Collapse
        size="small"
        items={[
          {
            key: 'targets',
            label: sharedT('uploadTargets'),
            children: (
              <AttachmentTargets
                type={ownerType === 'batch' ? 'distributor' : 'batch'}
                owner={owner}
                value={uploadTargets}
                onChange={setUploadTargets}
                disabled={busy}
              />
            ),
          },
        ]}
      />
      {filePicker}
      {choosing && owner && (
        <AttachmentCandidateDialog
          owner={owner}
          attachments={attachments}
          onClose={() => {
            setChoosing(false);
            onUploadingChange(false);
          }}
          onAdd={(items) => {
            const keys = new Set(attachments.map((item) => item.objectKey));
            const added = items.filter((item) => !keys.has(item.objectKey));
            if (attachments.length + added.length > MAX_ATTACHMENTS) {
              message.warning(attachmentT('limitExceeded', { limit: MAX_ATTACHMENTS }));
              return;
            }
            onChange(
              [
                ...attachments,
                ...added.map((item) => ({
                  objectKey: item.objectKey,
                  url: item.url,
                  fileName: item.fileName,
                  source: item.source,
                  notes: '',
                  position: 0,
                  targets: uploadTargets,
                })),
              ].map((item, position) => ({ ...item, position })),
            );
            setChoosing(false);
            onUploadingChange(false);
          }}
        />
      )}
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
          <LazyPreviewImage
            src={imageThumbnailUrl(attachment.url)}
            preview={{ src: attachment.url }}
            loading="lazy"
            alt={attachment.fileName}
            width={76}
            height={76}
          />
          <div className="batch-attachment-fields">
            <Tooltip title={attachment.fileName}>
              <span className="batch-attachment-name">{attachment.fileName}</span>
            </Tooltip>
            <div>
              {effectiveCover === attachment.objectKey ? (
                <Tag color="blue">{attachmentT('cover')}</Tag>
              ) : (
                <Button
                  size="small"
                  type="link"
                  disabled={busy}
                  onClick={() => onCoverChange(attachment.objectKey)}
                >
                  {attachmentT('setCover')}
                </Button>
              )}
            </div>
            <AttachmentRelations item={attachment} />
            {attachment.asset &&
              attachment.asset.distributors.length + attachment.asset.batches.length > 1 && (
                <Alert
                  type="info"
                  message={sharedT('sharedEdit', { locations: attachmentLocations(attachment) })}
                />
              )}
            <Input.TextArea
              aria-label={`${attachment.fileName} ${t('attachmentNotes')}`}
              placeholder={t('attachmentNotes')}
              value={attachment.notes}
              disabled={busy}
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
              disabled={busy}
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
              disabled={busy}
              icon={<DeleteOutlined />}
              aria-label={`${t('removeAttachment')} ${attachment.fileName}`}
              onClick={async () => {
                const confirmed = await modal.confirm({
                  title: sharedT('unlink'),
                  content: sharedT('unlinkHelp'),
                  okText: common('delete'),
                  cancelText: common('cancel'),
                  okButtonProps: { danger: true },
                  autoFocusButton: 'cancel',
                });
                if (!confirmed) return;
                const remaining = attachments
                  .filter((item) => item.objectKey !== attachment.objectKey)
                  .map((item, position) => ({ ...item, position }));
                onCoverChange(attachmentCoverKey(remaining, effectiveCover));
                onChange(remaining);
              }}
            />
          </Tooltip>
        </div>
      ))}
      {attachments.length < MAX_ATTACHMENTS && (
        <Button className="batch-attachment-upload" disabled={busy} onClick={openFilePicker}>
          {uploading ? <Spin size="small" /> : <PlusOutlined />}
          <span>{uploading ? t('uploading') : t('uploadAttachment')}</span>
        </Button>
      )}
      {owner && (
        <Button
          disabled={busy || attachments.length >= MAX_ATTACHMENTS}
          onClick={() => {
            setChoosing(true);
            onUploadingChange(true);
          }}
        >
          {attachmentT('chooseFromItems')}
        </Button>
      )}
      <span className="batch-attachment-hint">{t('attachmentHelp')}</span>
    </div>
  );
}
