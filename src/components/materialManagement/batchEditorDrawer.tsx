'use client';

import { App, Button, Drawer, Form, Input } from 'antd';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DateInput } from '@/components/date-input';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialBatch, MaterialBatchAttachment } from '@/lib/client-types';
import { todayInChina } from './batchSelector';
import { BatchAttachmentPicker } from './batchAttachmentPicker';

type Draft = {
  name: string;
  receivedAt: string;
  notes: string;
  attachments: MaterialBatchAttachment[];
};

export function BatchEditorDrawer({
  batch,
  onClose,
  onSaved,
}: {
  batch: MaterialBatch | null;
  onClose: () => void;
  onSaved: (batch: MaterialBatch) => void;
}) {
  const t = useTranslations('materialBatches');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [draft, setDraft] = useState<Draft>(() => ({
    name: batch?.name ?? '',
    receivedAt: batch?.receivedAt.slice(0, 10) ?? todayInChina(),
    notes: batch?.notes ?? '',
    attachments: batch?.attachments ?? [],
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function save() {
    setSubmitted(true);
    if (!draft.name.trim() || !draft.receivedAt || saving || uploading) return;
    setSaving(true);
    try {
      const saved = await apiFetch<MaterialBatch>(
        batch ? `/api/material-batches/${batch.id}` : '/api/material-batches',
        {
          method: batch ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: draft.name,
            receivedAt: draft.receivedAt,
            notes: draft.notes,
            attachments: draft.attachments.map(({ objectKey, fileName, notes }) => ({
              objectKey,
              fileName,
              notes,
            })),
          }),
        },
      );
      message.success(common('saved'));
      onSaved(saved);
      onClose();
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={batch ? t('editBatch') : t('newBatch')}
      open
      onClose={() => !uploading && !saving && onClose()}
      closable={!uploading && !saving}
      maskClosable={!uploading && !saving}
      keyboard={!uploading && !saving}
      width="min(560px, 100vw)"
      footer={
        <div className="batch-drawer-actions">
          <Button disabled={uploading || saving} onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="primary" loading={saving} disabled={uploading} onClick={() => void save()}>
            {common('save')}
          </Button>
        </div>
      }
    >
      <Form layout="vertical">
        <Form.Item
          label={t('name')}
          required
          validateStatus={submitted && !draft.name.trim() ? 'error' : undefined}
          help={submitted && !draft.name.trim() ? t('required') : undefined}
        >
          <Input
            aria-label={t('name')}
            value={draft.name}
            maxLength={120}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </Form.Item>
        <Form.Item
          label={t('date')}
          required
          validateStatus={submitted && !draft.receivedAt ? 'error' : undefined}
          help={submitted && !draft.receivedAt ? t('required') : undefined}
        >
          <DateInput
            aria-label={t('date')}
            value={draft.receivedAt}
            onChange={(date) => setDraft((current) => ({ ...current, receivedAt: date }))}
          />
        </Form.Item>
        <Form.Item label={t('notes')}>
          <Input.TextArea
            aria-label={t('notes')}
            value={draft.notes}
            maxLength={10000}
            rows={3}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          />
        </Form.Item>
        <Form.Item label={t('attachments')}>
          <BatchAttachmentPicker
            attachments={draft.attachments}
            onChange={(attachments) => setDraft((current) => ({ ...current, attachments }))}
            onUploadingChange={setUploading}
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
