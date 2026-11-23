'use client';

import { ImagePreviewGroup } from '@/components/imagePreviewGroup';

import { LazyPreviewImage } from '@/components/loadingImage';

import {
  ArrowRightOutlined,
  EditOutlined,
  PictureOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { App, Alert, Button, Checkbox, Collapse, Input, Modal, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client-api';
import type { AttachmentTarget } from '@/lib/shared-attachment-contracts';
import { AttachmentRelations, attachmentLocations } from './attachmentRelations';
import { AttachmentTargets } from './attachmentTargets';
import { AttachmentLinkDialog } from './attachmentLinkDialog';
import { ReceiptAssociationDialog } from './receiptAssociationDialog';
import sharedStyles from './sharedAttachments.module.css';
import { MAX_ATTACHMENTS, type AttachmentOwner } from '@/lib/attachments';
import { ClientApiError } from '@/lib/client-api';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import { imageThumbnailUrl } from '@/lib/image-storage';
import { AttachmentCandidateDialog } from './attachmentCandidateDialog';
import { AttachmentImageEditor } from './attachmentImageEditor';
import { ImageUploadChoiceDialog } from './imageUploadChoiceDialog';
import { uploadImage } from './uploadImage';
import { useImageFilePicker } from './useImageFilePicker';
import galleryStyles from './attachmentGallery.module.css';
import motionStyles from '../listMotion.module.css';

export type AttachmentState = {
  attachments: MaterialBatchAttachment[];
  coverObjectKey?: string | null;
};
export type AttachmentUpdate = (current: AttachmentState) => AttachmentState;

export function AttachmentGallery({
  owner,
  attachments,
  onSave,
  onRefresh,
  onUploadingChange,
}: {
  owner: AttachmentOwner;
  attachments: MaterialBatchAttachment[];
  onRefresh: () => Promise<void>;
  onSave: (update: AttachmentUpdate) => Promise<void>;
  onUploadingChange: (busy: boolean) => void;
}) {
  const t = useTranslations('attachments');
  const batchT = useTranslations('materialBatches');
  const imageT = useTranslations('imageUpload');
  const common = useTranslations('common');
  const { message, modal } = App.useApp();
  const sharedT = useTranslations('sharedAttachments');
  const [selected, setSelected] = useState<string[]>([]);
  const [association, setAssociation] = useState<'manual' | 'smart' | null>(null);
  const [uploadTargets, setUploadTargets] = useState<AttachmentTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [files, setFiles] = useState<File[] | null>(null);
  const [pendingAdd, setPendingAdd] = useState<MaterialBatchAttachment[]>([]);
  const [editing, setEditing] = useState<MaterialBatchAttachment | null>(null);
  const [notesAttachment, setNotesAttachment] = useState<MaterialBatchAttachment | null>(null);
  const [notes, setNotes] = useState('');
  const { openFilePicker, filePicker } = useImageFilePicker({
    disabled: busy || attachments.length >= MAX_ATTACHMENTS,
    onSelect: (selected) => {
      if (selected.length + attachments.length > MAX_ATTACHMENTS) {
        message.warning(t('limitExceeded', { limit: MAX_ATTACHMENTS }));
        return;
      }
      changeBusy(true);
      setFiles(selected);
    },
  });

  useEffect(() => {
    const refresh = () => {
      if (!busy && document.visibilityState === 'visible') void onRefresh().catch(() => {});
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [busy, onRefresh]);
  const selectedItems = attachments.filter((a) => a.assetId && selected.includes(a.assetId));
  async function command(operation: 'unlink' | 'delete', item: MaterialBatchAttachment) {
    const confirmed = await modal.confirm({
      title: sharedT(operation === 'unlink' ? 'unlink' : 'deleteEverywhere'),
      content:
        operation === 'unlink'
          ? sharedT('unlinkHelp')
          : sharedT('deleteHelp', { locations: attachmentLocations(item) }),
      okText: common('delete'),
      cancelText: common('cancel'),
      okButtonProps: { danger: true },
    });
    if (!confirmed) return;
    changeBusy(true);
    setSaving(true);
    try {
      await apiFetch('/api/attachments', {
        method: 'POST',
        body: JSON.stringify({
          operation,
          assets: [{ id: item.assetId, version: item.asset?.version }],
          ...(operation === 'unlink' ? { owner } : {}),
        }),
      });
      await onRefresh();
    } catch (error) {
      message.error(
        sharedT.has(error instanceof ClientApiError ? error.code : '')
          ? sharedT((error as ClientApiError).code as never)
          : sharedT('saveFailed'),
      );
    } finally {
      setSaving(false);
      changeBusy(false);
    }
  }
  async function sharedUpdate(item: MaterialBatchAttachment, data: Record<string, unknown>) {
    setSaving(true);
    try {
      await apiFetch('/api/attachments', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'update',
          asset: { id: item.assetId, version: item.asset?.version },
          ...data,
        }),
      });
      await onRefresh();
      message.success(common('saved'));
      finish();
      return true;
    } catch (error) {
      message.error(
        sharedT.has(error instanceof ClientApiError ? error.code : '')
          ? sharedT((error as ClientApiError).code as never)
          : sharedT('saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

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
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add(items: MaterialBatchAttachment[]) {
    changeBusy(true);
    const succeeded = await save((current) => {
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
    setPendingAdd(succeeded ? [] : items);
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
          targets: uploadTargets,
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
    setSaving(true);
    try {
      const replacement = await uploadImage(file);
      await sharedUpdate(editing, {
        replacement: { objectKey: replacement.objectKey, fileName: file.name.slice(0, 255) },
      });
    } catch {
      message.error(batchT('uploadFailed'));
      setSaving(false);
    }
  }

  return (
    <>
      {filePicker}
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
                onClick={openFilePicker}
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
        {!!pendingAdd.length && (
          <Alert
            type="warning"
            message={sharedT('pendingUpload', { count: pendingAdd.length })}
            action={
              <Space>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void add(pendingAdd.map((item) => ({ ...item, targets: uploadTargets })))
                  }
                >
                  {sharedT('retry')}
                </Button>
                <Button disabled={busy} onClick={() => setPendingAdd([])}>
                  {sharedT('cancel')}
                </Button>
              </Space>
            }
          />
        )}
        <div className={sharedStyles.toolbar}>
          <Checkbox
            disabled={busy || !attachments.length}
            checked={!!attachments.length && selectedItems.length === attachments.length}
            indeterminate={!!selectedItems.length && selectedItems.length < attachments.length}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? attachments.flatMap((a) => (a.assetId ? [a.assetId] : []))
                  : [],
              )
            }
          >
            {sharedT('selectAll')}
          </Checkbox>
          <span>{sharedT('selectedCount', { count: selectedItems.length })}</span>
          <Button
            disabled={busy || !selectedItems.length}
            onClick={() => {
              changeBusy(true);
              setAssociation('manual');
            }}
          >
            {sharedT(owner.type === 'batch' ? 'linkDistributors' : 'linkBatches')}
          </Button>
          <Button
            disabled={busy || !selectedItems.length}
            onClick={() => {
              changeBusy(true);
              setAssociation('smart');
            }}
          >
            {sharedT('smartLink')}
          </Button>
        </div>
        <div className={sharedStyles.uploadTargets}>
          <Collapse
            size="small"
            items={[
              {
                key: 'targets',
                label: sharedT('uploadTargets'),
                children: (
                  <AttachmentTargets
                    owner={owner}
                    type={owner.type === 'batch' ? 'distributor' : 'batch'}
                    value={uploadTargets}
                    onChange={setUploadTargets}
                    disabled={busy}
                  />
                ),
              },
            ]}
          />
        </div>
        {attachments.length ? (
          <ImagePreviewGroup
            items={attachments.map((attachment) => ({
              src: attachment.url,
              alt: attachment.fileName,
            }))}
          >
            <div
              className={`batch-detail-attachment-list ${galleryStyles.gallery} ${motionStyles.stagger}`}
              data-loading="false"
            >
              {attachments.map((attachment) => (
                <div className="batch-detail-attachment" key={attachment.objectKey}>
                  <LazyPreviewImage
                    src={imageThumbnailUrl(attachment.url, 640)}
                    preview={{ src: attachment.url }}
                    loading="lazy"
                    alt={attachment.fileName}
                    width={110}
                    height={110}
                  />
                  <div className="batch-detail-attachment-content">
                    <Checkbox
                      className={galleryStyles.attachmentName}
                      disabled={busy}
                      checked={!!attachment.assetId && selected.includes(attachment.assetId)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, attachment.assetId!]
                            : current.filter((id) => id !== attachment.assetId),
                        )
                      }
                    >
                      {attachment.fileName}
                    </Checkbox>
                    <AttachmentRelations item={attachment} />

                    {attachment.notes?.trim() && <p>{attachment.notes}</p>}
                    <Space wrap size="small" className={sharedStyles.actions}>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        disabled={busy}
                        aria-label={`${imageT('editImage')} ${attachment.fileName}`}
                        onClick={async () => {
                          const confirmed = await modal.confirm({
                            title: imageT('editImage'),
                            content: sharedT('sharedEdit', {
                              locations: attachmentLocations(attachment),
                            }),
                            okText: common('save'),
                            cancelText: common('cancel'),
                          });
                          if (!confirmed) return;
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
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => {
                          setSelected([attachment.assetId!]);
                          changeBusy(true);
                          setAssociation('manual');
                        }}
                      >
                        {sharedT('link')}
                      </Button>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => void command('unlink', attachment)}
                      >
                        {sharedT('unlink')}
                      </Button>
                      <Button
                        size="small"
                        danger
                        disabled={busy}
                        onClick={() => void command('delete', attachment)}
                      >
                        {sharedT('deleteEverywhere')}
                      </Button>
                    </Space>
                  </div>
                </div>
              ))}
            </div>
          </ImagePreviewGroup>
        ) : (
          <div className={galleryStyles.empty}>
            <div className={galleryStyles.choices}>
              <button
                type="button"
                className={galleryStyles.choice}
                disabled={busy}
                onClick={openFilePicker}
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
      {association === 'manual' && (
        <AttachmentLinkDialog
          owner={owner}
          items={selectedItems}
          onSaved={onRefresh}
          onClose={() => {
            setAssociation(null);
            setSelected([]);
            changeBusy(false);
          }}
        />
      )}
      {association === 'smart' && (
        <ReceiptAssociationDialog
          owner={owner}
          items={selectedItems}
          onSaved={onRefresh}
          onClose={() => {
            setAssociation(null);
            setSelected([]);
            changeBusy(false);
          }}
        />
      )}
      {choosing && (
        <AttachmentCandidateDialog
          owner={owner}
          attachments={attachments}
          onClose={finish}
          onAdd={(items) => {
            setChoosing(false);
            void add(
              items.map((item) => ({ ...item, notes: '', position: 0, targets: uploadTargets })),
            );
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
            void sharedUpdate(notesAttachment, { notes });
          }}
        >
          <Alert
            type="info"
            message={sharedT('sharedEdit', { locations: attachmentLocations(notesAttachment) })}
          />
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
