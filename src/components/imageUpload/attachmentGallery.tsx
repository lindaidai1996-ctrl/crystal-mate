'use client';

import {
  ArrowRightOutlined,
  EditOutlined,
  PictureOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { App, Button, Image, Input, Modal, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { attachmentCoverKey, MAX_ATTACHMENTS, type AttachmentOwner } from '@/lib/attachments';
import { ClientApiError } from '@/lib/client-api';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import { AttachmentCandidateDialog } from './attachmentCandidateDialog';
import { AttachmentImageEditor } from './attachmentImageEditor';
import { ImageUploadChoiceDialog } from './imageUploadChoiceDialog';
import { uploadImage } from './uploadImage';
import galleryStyles from './attachmentGallery.module.css';

export type AttachmentState = {
  attachments: MaterialBatchAttachment[];
  coverObjectKey?: string | null;
};
export type AttachmentUpdate = (current: AttachmentState) => AttachmentState;

export function AttachmentGallery({
  owner,
  attachments,
  onSave,
  onUploadingChange,
}: {
  owner: AttachmentOwner;
  attachments: MaterialBatchAttachment[];
  onSave: (update: AttachmentUpdate) => Promise<void>;
  onUploadingChange: (busy: boolean) => void;
}) {
  const t = useTranslations('attachments');
  const batchT = useTranslations('materialBatches');
  const imageT = useTranslations('imageUpload');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [files, setFiles] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<MaterialBatchAttachment | null>(null);
  const [notesAttachment, setNotesAttachment] = useState<MaterialBatchAttachment | null>(null);
  const [notes, setNotes] = useState('');

  function changeBusy(value: boolean) {
    setBusy(value);
    onUploadingChange(value);
  }

  function finish() {
    setChoosing(false);
    setFiles(null);
    setEditing(null);
    setNotesAttachment(null);
    changeBusy(false);
  }

  async function save(update: AttachmentUpdate, keepNotesOnError = false) {
    setSaving(true);
    try {
      await onSave(update);
      message.success(common('saved'));
      finish();
    } catch (error) {
      if (error instanceof ClientApiError && error.code === 'ATTACHMENT_LIMIT') {
        message.warning(t('limitExceeded', { limit: MAX_ATTACHMENTS }));
      } else {
        message.error(
          common(
            `errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never,
          ),
        );
      }
      if (!keepNotesOnError) finish();
    } finally {
      setSaving(false);
    }
  }

  async function add(items: MaterialBatchAttachment[]) {
    await save((current) => {
      const keys = new Set(current.attachments.map((item) => item.objectKey));
      const added = items.filter((item) => {
        if (keys.has(item.objectKey)) return false;
        keys.add(item.objectKey);
        return true;
      });
      if (current.attachments.length + added.length > MAX_ATTACHMENTS)
        throw new ClientApiError('ATTACHMENT_LIMIT');
      return {
        ...current,
        attachments: [...current.attachments, ...added].map((item, position) => ({
          ...item,
          position,
        })),
      };
    });
  }

  async function upload(selected: File[]) {
    setFiles(null);
    setSaving(true);
    const added: MaterialBatchAttachment[] = [];
    for (const file of selected) {
      try {
        added.push({
          ...(await uploadImage(file)),
          fileName: file.name.slice(0, 255),
          notes: '',
          position: 0,
        });
      } catch {
        message.error(batchT('uploadFailed'));
      }
    }
    if (added.length) await add(added);
    else {
      setSaving(false);
      finish();
    }
  }

  async function replaceImage(file: File) {
    if (!editing) return;
    const objectKey = editing.objectKey;
    setEditing(null);
    setSaving(true);
    try {
      const replacement = await uploadImage(file);
      await save((current) => {
        if (!current.attachments.some((item) => item.objectKey === objectKey))
          throw new ClientApiError('NOT_FOUND');
        return {
          coverObjectKey:
            attachmentCoverKey(current.attachments, current.coverObjectKey) === objectKey
              ? replacement.objectKey
              : current.coverObjectKey,
          attachments: current.attachments.map((item) =>
            item.objectKey === objectKey
              ? { ...item, ...replacement, source: undefined, fileName: file.name.slice(0, 255) }
              : item,
          ),
        };
      });
    } catch {
      message.error(batchT('uploadFailed'));
      setSaving(false);
      finish();
    }
  }

  return (
    <>
      <input
        ref={input}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy || attachments.length >= MAX_ATTACHMENTS}
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (!selected.length || busy) return;
          if (selected.length + attachments.length > MAX_ATTACHMENTS) {
            message.warning(t('limitExceeded', { limit: MAX_ATTACHMENTS }));
            return;
          }
          changeBusy(true);
          setFiles(selected);
        }}
      />
      <div className={galleryStyles.panel} aria-busy={saving}>
        <div className={galleryStyles.header}>
          <div className={galleryStyles.heading}>
            <h2>{batchT('attachments')}</h2>
            <span>{t('imageCount', { count: attachments.length })}</span>
          </div>
          {attachments.length > 0 && (
            <Space wrap size="small">
              <Button
                type="primary"
                icon={<UploadOutlined />}
                disabled={busy || attachments.length >= MAX_ATTACHMENTS}
                loading={saving}
                onClick={() => input.current?.click()}
              >
                {batchT('uploadAttachment')}
              </Button>
              <Button
                icon={<PictureOutlined />}
                disabled={busy || attachments.length >= MAX_ATTACHMENTS}
                onClick={() => {
                  changeBusy(true);
                  setChoosing(true);
                }}
              >
                {t('chooseImages')}
              </Button>
            </Space>
          )}
        </div>
        {attachments.length ? (
          <Image.PreviewGroup>
            <div className={`batch-detail-attachment-list ${galleryStyles.gallery}`}>
              {attachments.map((attachment) => (
                <div className="batch-detail-attachment" key={attachment.objectKey}>
                  <Image src={attachment.url} alt={attachment.fileName} width={110} height={110} />
                  <div className="batch-detail-attachment-content">
                    {attachment.notes?.trim() && <p>{attachment.notes}</p>}
                    <Space wrap size="small">
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        disabled={busy}
                        aria-label={`${imageT('editImage')} ${attachment.fileName}`}
                        onClick={() => {
                          changeBusy(true);
                          setEditing(attachment);
                        }}
                      >
                        {imageT('editImage')}
                      </Button>
                      <Button
                        size="small"
                        disabled={busy}
                        aria-label={`${t('editNotes')} ${attachment.fileName}`}
                        onClick={() => {
                          changeBusy(true);
                          setNotesAttachment(attachment);
                          setNotes(attachment.notes);
                        }}
                      >
                        {t('editNotes')}
                      </Button>
                    </Space>
                  </div>
                </div>
              ))}
            </div>
          </Image.PreviewGroup>
        ) : (
          <div className={galleryStyles.empty}>
            <div className={galleryStyles.choices}>
              <button
                type="button"
                className={galleryStyles.choice}
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                <span className={galleryStyles.icon}>
                  <UploadOutlined />
                </span>
                <span className={galleryStyles.choiceContent}>
                  <span className={galleryStyles.choiceTitle}>
                    {saving ? batchT('uploading') : batchT('uploadAttachment')}
                  </span>
                  <span className={galleryStyles.description}>{t('uploadDescription')}</span>
                </span>
                <ArrowRightOutlined className={galleryStyles.arrow} />
              </button>
              <button
                type="button"
                className={galleryStyles.choice}
                disabled={busy}
                onClick={() => {
                  changeBusy(true);
                  setChoosing(true);
                }}
              >
                <span className={galleryStyles.icon}>
                  <PictureOutlined />
                </span>
                <span className={galleryStyles.choiceContent}>
                  <span className={galleryStyles.choiceTitle}>{t('chooseImages')}</span>
                  <span className={galleryStyles.description}>{t('chooseDescription')}</span>
                </span>
                <ArrowRightOutlined className={galleryStyles.arrow} />
              </button>
            </div>
            <p className={galleryStyles.hint}>{t('galleryHelp')}</p>
          </div>
        )}
      </div>
      {choosing && (
        <AttachmentCandidateDialog
          owner={owner}
          attachments={attachments}
          onClose={finish}
          onAdd={(items) => {
            setChoosing(false);
            void add(items.map((item) => ({ ...item, notes: '', position: 0 })));
          }}
        />
      )}
      {files && (
        <ImageUploadChoiceDialog
          files={files}
          onCancel={finish}
          onConfirm={(items) => void upload(items)}
        />
      )}
      {editing && (
        <AttachmentImageEditor
          key={editing.objectKey}
          url={editing.url}
          fileName={editing.fileName}
          onCancel={finish}
          onConfirm={(file) => void replaceImage(file)}
        />
      )}
      {notesAttachment && (
        <Modal
          title={t('editNotes')}
          open
          onCancel={finish}
          closable={!saving}
          maskClosable={!saving}
          keyboard={!saving}
          cancelButtonProps={{ disabled: saving }}
          okText={common('save')}
          cancelText={common('cancel')}
          confirmLoading={saving}
          onOk={() => {
            if (saving) return;
            void save((current) => {
              if (!current.attachments.some((item) => item.objectKey === notesAttachment.objectKey))
                throw new ClientApiError('NOT_FOUND');
              return {
                ...current,
                attachments: current.attachments.map((item) =>
                  item.objectKey === notesAttachment.objectKey ? { ...item, notes } : item,
                ),
              };
            }, true);
          }}
        >
          <Input.TextArea
            aria-label={batchT('attachmentNotes')}
            placeholder={batchT('attachmentNotes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={saving}
            maxLength={1000}
            showCount
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
        </Modal>
      )}
    </>
  );
}
