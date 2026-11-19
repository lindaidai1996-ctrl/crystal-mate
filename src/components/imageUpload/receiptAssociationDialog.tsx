'use client';
import { Alert, App, Button, Checkbox, Modal, Select, Space, Spin, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { AttachmentOwner } from '@/lib/attachments';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import type { AttachmentTarget, ReceiptResult } from '@/lib/shared-attachment-contracts';
import { AttachmentTargets } from './attachmentTargets';
import { prepareLinkWithMerge, useMergeConfirmation } from './attachmentLinkDialog';
import { AttachmentRelations } from './attachmentRelations';
import { LazyPreviewImage } from '@/components/loadingImage';
import styles from './sharedAttachments.module.css';

type Model = { id: string; label: string; configured: boolean };
type Row = {
  item: MaterialBatchAttachment;
  recognition: ReceiptResult | null;
  loading: boolean;
  error: string;
  targets: AttachmentTarget[];
  skip: boolean;
  loaded: boolean;
};
export function ReceiptAssociationDialog({
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
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((item) => ({
      item,
      recognition: null,
      loading: false,
      error: '',
      targets: [],
      skip: false,
      loaded: false,
    })),
  );
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const controllers = useRef(new Map<string, { controller: AbortController; requestId: string }>());
  const alive = useRef(true);
  const [models, setModels] = useState<Model[]>([]);
  const [provider, setProvider] = useState('');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  function patch(id: string, value: Partial<Row>) {
    if (alive.current)
      setRows((current) =>
        current.map((row) => (row.item.assetId === id ? { ...row, ...value } : row)),
      );
  }
  useEffect(() => {
    alive.current = true;
    const activeTasks = controllers.current;
    const controller = new AbortController();
    const params = new URLSearchParams(owner);
    void Promise.all(
      items.map(async (item) => {
        try {
          const result = await apiFetch<{ models: Model[]; recognition: ReceiptResult | null }>(
            `/api/attachments/${item.assetId}/recognition?${params}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setModels(result.models);
            setProvider((current) => current || result.models.find((a) => a.configured)?.id || '');
            patch(item.assetId!, { recognition: result.recognition, loaded: true });
          }
        } catch (error) {
          if (!controller.signal.aborted)
            patch(item.assetId!, {
              loaded: true,
              error: error instanceof ClientApiError ? error.code : 'SERVER_ERROR',
            });
        }
      }),
    );
    return () => {
      alive.current = false;
      controller.abort();
      for (const [id, task] of activeTasks) {
        task.controller.abort();
        void apiFetch(`/api/attachments/${id}/recognition`, {
          method: 'DELETE',
          body: JSON.stringify({ requestId: task.requestId }),
        }).catch(() => {});
      }
      activeTasks.clear();
    };
    // A dialog is mounted once for its fixed selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function recognize(row: Row, force = false) {
    const id = row.item.assetId!;
    if (controllers.current.has(id)) return;
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    controllers.current.set(id, { controller, requestId });
    patch(id, { loading: true, error: '' });
    try {
      const recognition = await apiFetch<ReceiptResult>(`/api/attachments/${id}/recognition`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ owner, provider, requestId, force }),
      });
      if (!controller.signal.aborted) patch(id, { recognition, error: '' });
    } catch (error) {
      if (!controller.signal.aborted)
        patch(id, { error: error instanceof ClientApiError ? error.code : 'SERVER_ERROR' });
    } finally {
      controllers.current.delete(id);
      patch(id, { loading: false });
    }
  }
  async function recognizeAll() {
    setRunning(true);
    const queue = rowsRef.current.filter((a) => !a.skip && a.recognition?.status !== 'complete');
    await Promise.all(
      [0, 1].map(async () => {
        while (queue.length && alive.current) {
          const row = queue.shift();
          if (row) await recognize(row);
        }
      }),
    );
    if (alive.current) setRunning(false);
  }
  return (
    <Modal
      open
      width={900}
      title={t('smartLink')}
      onCancel={() => {
        if (!saving) onClose();
      }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      footer={
        <Space wrap>
          <Button disabled={saving} onClick={onClose}>
            {t('close')}
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={running || !rows.some((a) => !a.skip && a.targets.length)}
            onClick={async () => {
              setSaving(true);
              try {
                // A single transaction links the full accepted selection after explicit conflict resolution.
                const accepted = rows.filter((a) => !a.skip && a.targets.length);
                const links = [];
                for (const row of accepted) {
                  const refs = await prepareLinkWithMerge([row.item], row.targets, chooseNotes);
                  if (!refs) return;
                  links.push(
                    ...refs.map((asset) => ({
                      asset,
                      targets: row.targets.map(({ type, id }) => ({ type, id })),
                    })),
                  );
                }
                await apiFetch('/api/attachments', {
                  method: 'POST',
                  body: JSON.stringify({ operation: 'linkMany', items: links }),
                });
                await onSaved();
                message.success(t('linked'));
                onClose();
              } catch (error) {
                message.error(
                  t.has(error instanceof ClientApiError ? error.code : '')
                    ? t((error as ClientApiError).code as never)
                    : t('saveFailed'),
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {t('confirmSelected')}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="info" message={t('recognitionHelp')} />
        <Space wrap>
          <Select
            aria-label={t('model')}
            placeholder={t('model')}
            value={provider || undefined}
            style={{ minWidth: 200 }}
            disabled={running || saving || rows.some((a) => a.loading)}
            onChange={setProvider}
            options={models.map((model) => ({
              value: model.id,
              label: model.label,
              disabled: !model.configured,
            }))}
          />
          <Button
            disabled={
              !provider || saving || rows.some((a) => a.loading) || rows.some((a) => !a.loaded)
            }
            loading={running}
            onClick={() => void recognizeAll()}
          >
            {t('recognizeAll')}
          </Button>
        </Space>
        {!provider && models.length > 0 && (
          <Alert type="warning" message={t('IMPORT_MODEL_NOT_CONFIGURED')} />
        )}
        <div className={styles.receipts}>
          {rows.map((row) => (
            <div className={styles.receipt} key={row.item.assetId}>
              <div className={styles.receiptHeader}>
                <LazyPreviewImage
                  src={row.item.url}
                  preview={{ src: row.item.url }}
                  width={100}
                  height={100}
                  alt={row.item.fileName}
                />
                <div className={styles.evidence}>
                  <strong>{row.item.fileName}</strong>
                  <AttachmentRelations item={row.item} />
                  <Checkbox
                    checked={row.skip}
                    disabled={saving}
                    onChange={(event) => patch(row.item.assetId!, { skip: event.target.checked })}
                  >
                    {t('skip')}
                  </Checkbox>
                </div>
              </div>
              {!row.loaded || row.loading ? <Spin /> : null}
              {row.error && (
                <Alert
                  type="error"
                  message={t.has(row.error) ? t(row.error as never) : t('recognitionFailed')}
                />
              )}
              {!row.error &&
                row.recognition &&
                ['failed', 'cancelled'].includes(row.recognition.status) && (
                  <Alert
                    type="warning"
                    message={
                      row.recognition.errorCode && t.has(row.recognition.errorCode)
                        ? t(row.recognition.errorCode as never)
                        : t('recognitionFailed')
                    }
                  />
                )}
              {row.recognition?.status === 'running' && (
                <Alert
                  type="info"
                  message={t('recognitionRunning')}
                  action={
                    <Button
                      onClick={async () => {
                        try {
                          const params = new URLSearchParams(owner);
                          const data = await apiFetch<{ recognition: ReceiptResult | null }>(
                            `/api/attachments/${row.item.assetId}/recognition?${params}`,
                          );
                          patch(row.item.assetId!, { recognition: data.recognition, error: '' });
                        } catch (error) {
                          patch(row.item.assetId!, {
                            error: error instanceof ClientApiError ? error.code : 'SERVER_ERROR',
                          });
                        }
                      }}
                    >
                      {t('refresh')}
                    </Button>
                  }
                />
              )}
              {row.recognition?.result && (
                <div className={styles.evidence}>
                  <span>
                    {t('documentType')}: {row.recognition.result.documentType ?? t('unknown')}
                  </span>
                  <span>
                    {t('seller')}:{' '}
                    {[
                      row.recognition.result.seller.name,
                      row.recognition.result.seller.phone,
                      row.recognition.result.seller.address,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('unknown')}
                  </span>
                  <span>
                    {t('buyer')}:{' '}
                    {[
                      row.recognition.result.buyer.name,
                      row.recognition.result.buyer.phone,
                      row.recognition.result.buyer.address,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('unknown')}
                  </span>
                  <span>
                    {t('dates')}:{' '}
                    {row.recognition.result.dates
                      .map((date) => `${date.label} ${date.value}`)
                      .join('；') || t('unknown')}
                  </span>
                  {row.recognition.result.warnings.map((warning, index) => (
                    <Alert key={index} type="warning" message={warning} />
                  ))}
                </div>
              )}
              <div className={styles.actions}>
                <Button
                  disabled={!provider || running || row.loading || saving || !row.loaded}
                  onClick={() => void recognize(row, row.recognition?.status === 'complete')}
                >
                  {t(row.recognition?.status === 'complete' ? 'recognizeAgain' : 'recognize')}
                </Button>
              </div>
              {row.recognition?.status === 'complete' && (
                <>
                  <p>{t('suggestionsHelp')}</p>
                  {!row.recognition.suggestions.length && (
                    <Alert type="info" message={t('noSuggestions')} />
                  )}
                  <Space wrap className={styles.suggestions}>
                    {row.recognition.suggestions.map((target) => (
                      <Button
                        key={target.id}
                        disabled={saving || row.skip}
                        onClick={() =>
                          patch(row.item.assetId!, {
                            targets: row.targets.some((a) => a.id === target.id)
                              ? row.targets.filter((a) => a.id !== target.id)
                              : [...row.targets, target],
                          })
                        }
                        type={row.targets.some((a) => a.id === target.id) ? 'primary' : 'default'}
                      >
                        {target.name} {target.receivedAt}{' '}
                        <Tag>{t((target.reason ?? 'purchaseRelation') as never)}</Tag>
                      </Button>
                    ))}
                  </Space>
                </>
              )}
              <AttachmentTargets
                type={owner.type === 'batch' ? 'distributor' : 'batch'}
                owner={owner}
                value={row.targets}
                onChange={(targets) => patch(row.item.assetId!, { targets })}
                disabled={saving || row.skip}
              />
            </div>
          ))}
        </div>
      </Space>
    </Modal>
  );
}
