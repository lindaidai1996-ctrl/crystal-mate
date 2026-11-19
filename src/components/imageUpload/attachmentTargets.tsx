'use client';
import { Alert, Button, Checkbox, Empty, Input, Pagination, Space, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import type { AttachmentOwner } from '@/lib/attachments';
import type { AttachmentTarget } from '@/lib/shared-attachment-contracts';
import styles from './sharedAttachments.module.css';
export function AttachmentTargets({
  type,
  owner,
  value,
  onChange,
  disabled = false,
}: {
  type: 'batch' | 'distributor';
  owner?: AttachmentOwner;
  value: AttachmentTarget[];
  onChange: (next: AttachmentTarget[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('sharedAttachments');
  const ownerType = owner?.type;
  const ownerId = owner?.id;
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<{ items: AttachmentTarget[]; total: number }>({
    items: [],
    total: 0,
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        type,
        q,
        page: String(page),
        ...(ownerType && ownerId ? { ownerType, ownerId } : {}),
      });
      apiFetch<{ items: AttachmentTarget[]; total: number }>(`/api/attachments?${params}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setData(result);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [type, ownerType, ownerId, q, page, attempt]);
  return (
    <div className={styles.targets}>
      <Input.Search
        aria-label={t(type === 'batch' ? 'searchBatches' : 'searchDistributors')}
        placeholder={t(type === 'batch' ? 'searchBatches' : 'searchDistributors')}
        maxLength={200}
        value={q}
        allowClear
        disabled={disabled}
        onChange={(event) => {
          setLoading(true);
          setQ(event.target.value);
          setPage(1);
        }}
      />
      {!!value.length && (
        <Space wrap>
          {value.map((item) => (
            <Tag
              closable={!disabled}
              key={item.id}
              onClose={() => onChange(value.filter((a) => a.id !== item.id))}
            >
              {item.name}
            </Tag>
          ))}
        </Space>
      )}
      {failed ? (
        <Alert
          type="error"
          message={t('loadFailed')}
          action={
            <Button
              onClick={() => {
                setLoading(true);
                setAttempt((n) => n + 1);
              }}
            >
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <Spin spinning={loading}>
          <div className={styles.targetList}>
            {data.items.map((item) => (
              <Checkbox
                disabled={
                  disabled ||
                  loading ||
                  (!value.some((a) => a.id === item.id) && value.length >= 50)
                }
                key={item.id}
                checked={value.some((a) => a.id === item.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...value, item] : value.filter((a) => a.id !== item.id),
                  )
                }
              >
                <span>{item.name}</span>
                {item.receivedAt && <span className={styles.secondary}> · {item.receivedAt}</span>}
                {item.related && <Tag>{t('purchaseRelated')}</Tag>}
              </Checkbox>
            ))}
            {!data.items.length && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        </Spin>
      )}
      <Pagination
        simple
        current={page}
        total={data.total}
        pageSize={20}
        showSizeChanger={false}
        disabled={disabled || loading}
        onChange={(next) => {
          setLoading(true);
          setPage(next);
        }}
      />
    </div>
  );
}
