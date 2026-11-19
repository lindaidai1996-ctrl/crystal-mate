'use client';
import { Alert, App, Modal, Radio, Space } from 'antd';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { AttachmentOwner } from '@/lib/attachments';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import type { AttachmentTarget } from '@/lib/shared-attachment-contracts';
import { AttachmentTargets } from './attachmentTargets';
import { attachmentLocations } from './attachmentRelations';

type Detail = {
  id: string;
  version: number;
  objectKey: string;
  notes: string;
  fileName: string;
  distributors: { distributor: { id: string; name: string } }[];
  batches: { batch: { id: string; name: string } }[];
};
export async function prepareLinkWithMerge(
  items: MaterialBatchAttachment[],
  targets: AttachmentTarget[],
  chooseNotes: (groups: Detail[][]) => Promise<string[] | null>,
) {
  const refs = items
    .filter((a) => a.assetId && a.asset)
    .map((a) => ({ id: a.assetId!, version: a.asset!.version }));
  const conflicts = await apiFetch<Detail[]>('/api/attachments', {
    method: 'POST',
    body: JSON.stringify({
      operation: 'conflicts',
      ids: refs.map((a) => a.id),
      targets: targets.map(({ type, id }) => ({ type, id })),
    }),
  });
  const groups: Detail[][] = [];
  const byKey = new Map<string, Detail[]>();
  const details = await Promise.all(refs.map((a) => apiFetch<Detail>(`/api/attachments/${a.id}`)));
  // Do not silently confirm changes made since this dialog opened.
  for (const detail of details)
    if (refs.find((a) => a.id === detail.id)?.version !== detail.version)
      throw new ClientApiError('ATTACHMENT_CONFLICT');
  for (const detail of [...details, ...conflicts]) {
    const group = byKey.get(detail.objectKey) ?? [];
    if (!group.some((a) => a.id === detail.id)) group.push(detail);
    byKey.set(detail.objectKey, group);
  }
  for (const group of byKey.values()) if (group.length > 1) groups.push(group);
  if (groups.length) {
    const notes = await chooseNotes(groups);
    if (!notes) return null;
    for (const [index, group] of groups.entries()) {
      await apiFetch('/api/attachments', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'merge',
          assets: group.map((a) => ({ id: a.id, version: a.version })),
          notes: notes[index],
        }),
      });
      const keeper = await apiFetch<Detail>(`/api/attachments/${group[0].id}`);
      const removed = new Set(group.map((a) => a.id));
      for (let i = refs.length - 1; i >= 0; i--) if (removed.has(refs[i].id)) refs.splice(i, 1);
      refs.push({ id: keeper.id, version: keeper.version });
    }
  }
  return refs;
}
export async function linkWithMerge(
  items: MaterialBatchAttachment[],
  targets: AttachmentTarget[],
  chooseNotes: (groups: Detail[][]) => Promise<string[] | null>,
) {
  const refs = await prepareLinkWithMerge(items, targets, chooseNotes);
  if (!refs) return false;
  await apiFetch('/api/attachments', {
    method: 'POST',
    body: JSON.stringify({
      operation: 'link',
      assets: refs,
      targets: targets.map(({ type, id }) => ({ type, id })),
    }),
  });
  return true;
}

export function useMergeConfirmation() {
  const t = useTranslations('sharedAttachments');
  const { modal } = App.useApp();
  return async (groups: Detail[][]) => {
    const choices = groups.map((group) =>
      group.every((a) => a.notes === group[0].notes) ? group[0].notes : null,
    );
    const confirmed = await modal.confirm({
      title: t('mergeTitle'),
      width: 640,
      content: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="warning" message={t('mergeHelp')} />
          {groups.map((group, index) => (
            <div key={group[0].objectKey}>
              <p>{group[0].fileName}</p>
              <p>
                {[
                  ...new Set(
                    group.flatMap((a) => [
                      ...a.distributors.map((d) => d.distributor.name),
                      ...a.batches.map((b) => b.batch.name),
                    ]),
                  ),
                ].join('、')}
              </p>
              <Radio.Group
                defaultValue={choices[index]}
                onChange={(event) => {
                  choices[index] = event.target.value;
                }}
              >
                {[...new Set(group.map((a) => a.notes))].map((notes) => (
                  <Radio key={notes} value={notes}>
                    {notes || t('emptyNotes')}
                  </Radio>
                ))}
              </Radio.Group>
            </div>
          ))}
        </Space>
      ),
      okText: t('mergeConfirm'),
      cancelText: t('cancel'),
      onOk: () => {
        if (choices.some((a) => a === null)) {
          modal.warning({ title: t('chooseNotes') });
          throw new Error('Choose notes');
        }
      },
    });
    return confirmed ? (choices as string[]) : null;
  };
}
export function AttachmentLinkDialog({
  owner,
  items,
  onClose,
  onSaved,
}: {
  owner: AttachmentOwner;
  items: MaterialBatchAttachment[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('sharedAttachments');
  const { message } = App.useApp();
  const chooseNotes = useMergeConfirmation();
  const [targets, setTargets] = useState<AttachmentTarget[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState('');
  return (
    <Modal
      open
      title={t(owner.type === 'batch' ? 'linkDistributors' : 'linkBatches')}
      width={680}
      onCancel={() => {
        if (!saving) onClose();
      }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      confirmLoading={saving}
      okButtonProps={{ disabled: !targets.length }}
      okText={t('confirmLink')}
      cancelText={t('cancel')}
      onOk={async () => {
        setSaving(true);
        setFailed('');
        try {
          if (await linkWithMerge(items, targets, chooseNotes)) {
            await onSaved();
            message.success(t('linked'));
            onClose();
          }
        } catch (error) {
          setFailed(error instanceof ClientApiError ? error.code : 'SERVER_ERROR');
        } finally {
          setSaving(false);
        }
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          type="info"
          message={t('selectedCount', { count: items.length })}
          description={items.map((a) => `${a.fileName} · ${attachmentLocations(a)}`).join('；')}
        />
        {failed && (
          <Alert type="error" message={t.has(failed) ? t(failed as never) : t('saveFailed')} />
        )}
        <AttachmentTargets
          type={owner.type === 'batch' ? 'distributor' : 'batch'}
          owner={owner}
          value={targets}
          onChange={setTargets}
          disabled={saving}
        />
      </Space>
    </Modal>
  );
}
