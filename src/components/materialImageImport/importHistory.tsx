'use client';

import { useState } from 'react';
import { Empty, Input, Pagination, Skeleton, Tag } from 'antd';
import { ArrowRightOutlined, SearchOutlined } from '@ant-design/icons';
import { useFormatter, useTranslations } from 'next-intl';
import { LoadingImage } from '@/components/loadingImage';
import { imageThumbnailUrl } from '@/lib/image-storage';
import type { ImportHistoryItem } from './useImageImport';
import importStyles from './materialImageImport.module.css';

const pageSize = 5;

export function ImportHistory({
  items,
  loading,
  disabled,
  currentId,
  onSelect,
}: {
  items: ImportHistoryItem[];
  loading: boolean;
  disabled: boolean;
  currentId?: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('imageImport');
  const format = useFormatter();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = items.filter((item) =>
    item.fileName.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));

  return (
    <section className={importStyles.historyPanel} aria-label={t('historyTitle')}>
      <div className={importStyles.sectionHeading}>
        <h2>
          {t('historyTitle')} <span className={importStyles.historyCount}>{items.length}</span>
        </h2>
        <p>{t('historyDescription')}</p>
      </div>
      {!loading && items.length > 0 && (
        <Input
          allowClear
          prefix={<SearchOutlined />}
          aria-label={t('historySearch')}
          placeholder={t('historySearch')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      )}
      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : filtered.length ? (
        <ul className={importStyles.historyList}>
          {filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((item) => {
            const completed = item._count.items > 0 && item.importedCount === item._count.items;
            const readOnly = completed || !!item.archivedAt;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={importStyles.historyRecord}
                  disabled={disabled}
                  aria-current={item.id === currentId ? 'true' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <LoadingImage
                    src={imageThumbnailUrl(item.sourceUrl)}
                    alt=""
                    width={60}
                    height={60}
                    className={importStyles.historyImage}
                  />
                  <span className={importStyles.historyRecordContent}>
                    <strong>{item.fileName}</strong>
                    <span className={importStyles.historyMeta}>
                      <Tag color={completed ? 'success' : readOnly ? 'default' : 'processing'}>
                        {t(
                          completed
                            ? 'historyCompleted'
                            : readOnly
                              ? 'historyArchived'
                              : 'historyDraft',
                        )}
                      </Tag>
                      <span>
                        {t('historyProgress', {
                          imported: item.importedCount,
                          total: item._count.items,
                        })}
                      </span>
                    </span>
                    <span className={importStyles.historyFooter}>
                      <time dateTime={item.createdAt}>
                        {format.dateTime(new Date(item.createdAt), {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                      <span className={importStyles.historyAction}>
                        {t(
                          item.id === currentId
                            ? 'historyCurrent'
                            : readOnly
                              ? 'historyView'
                              : 'historyContinue',
                        )}{' '}
                        <ArrowRightOutlined />
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t(query ? 'historyNoMatch' : 'historyEmpty')}
        />
      )}
      {!loading && filtered.length > pageSize && (
        <Pagination
          size="small"
          current={currentPage}
          pageSize={pageSize}
          total={filtered.length}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
    </section>
  );
}
