'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Popconfirm, Space, Tag } from 'antd';
import { DeleteOutlined, MergeCellsOutlined, PlusOutlined, ScanOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { MaterialCategory, Tag as MaterialTag } from '@/lib/client-types';
import { newImportItem, type ImageImport } from '@/lib/materialImageImport/contracts';
import { ImportCandidates } from './importCandidates';
import { ImportItemEditor } from './importItemEditor';
import { ImportRecognitionDialog } from './importRecognitionDialog';
import type { useImageImport } from './useImageImport';
import importStyles from './materialImageImport.module.css';

export function ImportReviewWorkspace({
  job,
  state,
  disabled,
  provider,
  configured,
  categories,
  tags,
  onTagCreated,
  onCategoryCreated,
  onUploadingChange,
}: {
  job: ImageImport;
  state: ReturnType<typeof useImageImport>;
  disabled: boolean;
  provider: string;
  configured: boolean;
  categories: MaterialCategory[];
  tags: MaterialTag[];
  onTagCreated: (tag: MaterialTag) => void;
  onCategoryCreated: (category: MaterialCategory) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations('imageImport');
  const editingDisabled = disabled || !!job.archivedAt;
  const [framing, setFraming] = useState(false);
  const reviewBody = useRef<HTMLDivElement>(null);
  const active = job.items.find((item) => item.id === state.activeId) ?? job.items[0];
  const index = job.items.findIndex((item) => item.id === active?.id);
  const selected = job.items.filter((item) => item.data.selected && !item.entryId);
  const reviewed = job.items.filter((item) => item.data.reviewed || item.entryId).length;
  const issues = state.validation?.items.find((item) => item.id === active?.id)?.issues ?? [];

  useEffect(() => {
    if (reviewBody.current) reviewBody.current.scrollTop = 0;
  }, [active?.id]);

  function select(id: string) {
    state.select(id);
    if (reviewBody.current) reviewBody.current.scrollTop = 0;
  }

  function addItem() {
    const id = crypto.randomUUID();
    state.edit((current) => ({
      ...current,
      items: [
        ...current.items,
        { id, data: newImportItem(current.settings.priceKind), materialId: null, entryId: null },
      ],
    }));
    select(id);
    setFraming(true);
  }

  function merge() {
    if (selected.length < 2) return;
    const boxes = selected.map((item) => item.data.objectBox);
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const first = selected[0];
    const ids = new Set(selected.slice(1).map((item) => item.id));
    state.edit((current) => ({
      ...current,
      items: current.items
        .filter((item) => !ids.has(item.id))
        .map((item) =>
          item.id === first.id
            ? {
                ...item,
                data: {
                  ...newImportItem(current.settings.priceKind, {
                    x,
                    y,
                    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
                    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
                  }),
                  warnings: [t('mergeWarning')],
                },
              }
            : item,
        ),
    }));
    select(first.id);
  }

  async function confirmNext() {
    if (!active) return;
    await state.confirm(active.id);
    if (reviewBody.current) reviewBody.current.scrollTop = 0;
  }

  return (
    <>
      <div className={importStyles.workspace}>
        <aside className={importStyles.candidateSidebar}>
          <ImportCandidates
            job={job}
            activeId={active?.id ?? null}
            disabled={disabled}
            onSelect={select}
            onChange={state.patchItem}
            validation={state.validation}
          />
          <div className={importStyles.structureActions}>
            <Button
              size="small"
              icon={<PlusOutlined />}
              disabled={editingDisabled || job.items.length >= 100}
              onClick={addItem}
            >
              {t('addItem')}
            </Button>
            <Popconfirm
              title={t('mergeConfirm')}
              disabled={selected.length < 2 || editingDisabled}
              onConfirm={merge}
            >
              <Button
                size="small"
                icon={<MergeCellsOutlined />}
                disabled={selected.length < 2 || editingDisabled}
              >
                {t('merge')}
              </Button>
            </Popconfirm>
          </div>
        </aside>
        <section className={importStyles.review} aria-label={t('stepReview')}>
          {active ? (
            <>
              <div className={importStyles.reviewHeader}>
                <div>
                  <h2>{t('reviewingItem', { number: index + 1, count: job.items.length })}</h2>
                  <span className={importStyles.hint}>
                    {t('reviewProgress', { reviewed, count: job.items.length })}
                  </span>
                </div>
                <Space wrap>
                  <Tag
                    color={active.entryId ? 'success' : active.data.reviewed ? 'blue' : 'default'}
                  >
                    {t(
                      active.entryId
                        ? 'candidateImported'
                        : active.data.reviewed
                          ? 'candidateReviewed'
                          : 'candidatePending',
                    )}
                  </Tag>
                  <Button
                    icon={<ScanOutlined />}
                    disabled={editingDisabled || !!active.entryId}
                    onClick={() => setFraming(true)}
                  >
                    {t('reframeItem')}
                  </Button>
                  <Popconfirm
                    title={t('deleteConfirm')}
                    disabled={editingDisabled || !!active.entryId}
                    onConfirm={() => {
                      state.edit((current) => ({
                        ...current,
                        items: current.items.filter((item) => item.id !== active.id),
                      }));
                      select(job.items[index + 1]?.id ?? job.items[index - 1]?.id ?? '');
                    }}
                  >
                    <Button
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label={t('deleteItem')}
                      disabled={editingDisabled || !!active.entryId}
                    />
                  </Popconfirm>
                </Space>
              </div>
              <div
                className={importStyles.reviewContent}
                ref={reviewBody}
                data-import-review-content
              >
                {!!issues.length && (
                  <Alert
                    type="error"
                    showIcon
                    message={t('validationCurrentItem')}
                    className={importStyles.notice}
                    description={
                      <ul>
                        {issues.map((issue) => (
                          <li key={issue.code}>{t(`validation.${issue.code}`)}</li>
                        ))}
                      </ul>
                    }
                  />
                )}
                <ImportItemEditor
                  key={active.id}
                  item={active}
                  sourceUrl={job.sourceUrl}
                  sourceRatio={job.width / job.height}
                  categories={categories}
                  tags={tags}
                  disabled={editingDisabled}
                  onTagCreated={onTagCreated}
                  onCategoryCreated={onCategoryCreated}
                  onUploadingChange={onUploadingChange}
                  onChange={(patch) => state.patchItem(active.id, patch)}
                />
              </div>
              <div className={importStyles.reviewNavigation}>
                <Space wrap>
                  <Button
                    disabled={
                      disabled ||
                      !job.items.some(
                        (item) => !item.entryId && item.data.selected && !item.data.reviewed,
                      )
                    }
                    onClick={state.continueReview}
                  >
                    {t('continuePending')}
                  </Button>
                  <Button
                    disabled={disabled || index <= 0}
                    onClick={() => select(job.items[index - 1].id)}
                  >
                    {t('previousItem')}
                  </Button>
                  <Button
                    disabled={disabled || index === job.items.length - 1}
                    onClick={() => select(job.items[index + 1].id)}
                  >
                    {t('nextItem')}
                  </Button>
                </Space>
                <Button
                  type="primary"
                  loading={state.saving}
                  disabled={editingDisabled || !!active.entryId}
                  onClick={confirmNext}
                >
                  {t('confirmAndNext')}
                </Button>
              </div>
            </>
          ) : (
            <Empty description={t('noItems')} className={importStyles.emptyReview} />
          )}
        </section>
      </div>
      {framing && active && (
        <ImportRecognitionDialog
          key={active.id}
          job={job}
          item={active}
          busy={state.busy}
          configured={configured}
          onRecognize={(boxes) => state.recognizeItem(active.id, provider, boxes)}
          onApply={(patch) => state.patchItem(active.id, patch)}
          onClose={() => setFraming(false)}
          errorText={state.errorText}
        />
      )}
    </>
  );
}
