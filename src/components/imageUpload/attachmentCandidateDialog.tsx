'use client';

import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Image,
  Input,
  Modal,
  Pagination,
  Segmented,
  Spin,
  Tag,
} from 'antd';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import {
  MAX_ATTACHMENTS,
  type AttachmentCandidate,
  type AttachmentCandidatePage,
  type AttachmentOwner,
} from '@/lib/attachments';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import styles from './attachmentCandidateDialog.module.css';

export function AttachmentCandidateDialog({
  owner,
  attachments,
  onAdd,
  onClose,
}: {
  owner: AttachmentOwner;
  attachments: MaterialBatchAttachment[];
  onAdd: (items: AttachmentCandidate[]) => void;
  onClose: () => void;
}) {
  const t = useTranslations('attachments');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [q, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AttachmentCandidatePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<Map<string, AttachmentCandidate>>(new Map());
  const existing = new Set(attachments.map((item) => item.objectKey));
  const capacity = MAX_ATTACHMENTS - attachments.length;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q, type, page: String(page), pageSize: '20' });
      const root = owner.type === 'batch' ? 'material-batches' : 'distributors';
      apiFetch<AttachmentCandidatePage>(
        `/api/${root}/${owner.id}/attachment-candidates?${params}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult(data);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [owner.id, owner.type, q, type, page, attempt]);

  function select(items: AttachmentCandidate[], checked: boolean) {
    const next = new Map(selected);
    for (const item of items) {
      if (checked && !existing.has(item.objectKey)) next.set(item.objectKey, item);
      else if (!checked) next.delete(item.objectKey);
    }
    if (next.size > capacity) {
      message.warning(t('limitExceeded', { limit: MAX_ATTACHMENTS }));
      return;
    }
    setSelected(next);
  }

  const available = (result?.items ?? []).filter((item) => !existing.has(item.objectKey));
  const selectedOnPage = available.filter((item) => selected.has(item.objectKey)).length;
  const allOnPage = available.length > 0 && selectedOnPage === available.length;

  return (
    <Modal
      title={t('chooseFromItems')}
      open
      width={760}
      onCancel={onClose}
      footer={
        <div className={styles.footer}>
          <span>
            {t('selectionCount', { count: selected.size, remaining: capacity - selected.size })}
          </span>
          <div className={styles.actions}>
            <Button onClick={onClose}>{common('cancel')}</Button>
            <Button
              type="primary"
              disabled={!selected.size}
              onClick={() => {
                if (selected.size > capacity) {
                  message.warning(t('limitExceeded', { limit: MAX_ATTACHMENTS }));
                  return;
                }
                onAdd([...selected.values()]);
              }}
            >
              {t('addSelected', { count: selected.size })}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.filters}>
        <Input.Search
          aria-label={t('search')}
          placeholder={t('search')}
          value={q}
          maxLength={200}
          allowClear
          onChange={(event) => {
            setLoading(true);
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <Segmented
          value={type}
          onChange={(value) => {
            setLoading(true);
            setType(value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: t('all') },
            { value: 'material', label: t('material') },
            { value: 'product', label: t('product') },
          ]}
        />
      </div>
      {failed && !loading ? (
        <Alert
          type="error"
          showIcon
          message={t('loadFailed')}
          action={
            <Button
              onClick={() => {
                setLoading(true);
                setAttempt((value) => value + 1);
              }}
            >
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <>
          <Checkbox
            disabled={loading || !available.length}
            checked={allOnPage}
            indeterminate={selectedOnPage > 0 && !allOnPage}
            onChange={(event) => select(available, event.target.checked)}
          >
            {t('selectPage')}
          </Checkbox>
          <Spin spinning={loading}>
            <div className={styles.grid}>
              {result?.items.map((item) => {
                const added = existing.has(item.objectKey);
                const checked = selected.has(item.objectKey);
                return (
                  <div
                    className={`${styles.card} ${checked ? styles.selected : ''}`}
                    key={`${item.type}:${item.itemId}`}
                  >
                    <Image src={item.url} alt={item.name} width="100%" height={120} />
                    <Checkbox
                      checked={added || checked}
                      disabled={loading || added || (!checked && selected.size >= capacity)}
                      onChange={(event) => select([item], event.target.checked)}
                    >
                      <span className={styles.name}>{item.name}</span>
                    </Checkbox>
                    {item.code && <span className={styles.code}>{item.code}</span>}
                    <div>
                      <Tag>{t(item.type === 'MATERIAL' ? 'material' : 'product')}</Tag>
                      {added && <Tag>{t('alreadyAdded')}</Tag>}
                    </div>
                  </div>
                );
              })}
            </div>
            {!loading && !result?.items.length && <Empty description={t('empty')} />}
          </Spin>
          <Pagination
            className={styles.pagination}
            current={page}
            pageSize={20}
            total={result?.total ?? 0}
            showSizeChanger={false}
            onChange={(value) => {
              setLoading(true);
              setPage(value);
            }}
          />
        </>
      )}
    </Modal>
  );
}
