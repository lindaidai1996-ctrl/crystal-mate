'use client';

import {
  ArrowLeftOutlined,
  DeleteOutlined,
  InboxOutlined,
  PictureOutlined,
  ScanOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Collapse,
  Empty,
  Image,
  Popconfirm,
  Select,
  Space,
  Steps,
  Tag,
  Upload,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useNavigationGuard } from '@/components/navigationGuard';
import { apiFetch } from '@/lib/client-api';
import type {
  Distributor,
  DistributorPage,
  MaterialBatch,
  MaterialCategory,
  Tag as MaterialTag,
} from '@/lib/client-types';
import type { ImportItemData } from '@/lib/materialImageImport/contracts';
import { patchImportItem } from '@/lib/materialImageImport/materialDraft';
import { ImageCropDialog } from '@/components/imageUpload/imageCropDialog';
import { ImportReviewWorkspace } from './importReviewWorkspace';
import { ImportSettings } from './importSettings';
import { useImageImport } from './useImageImport';
import { ImportDraftFeedback, ImportDraftStatus } from './importDraftFeedback';
import { ImportValidationFeedback } from './importValidationFeedback';
import importStyles from './materialImageImport.module.css';

export function ImageImportPage({ initialId }: { initialId?: string }) {
  const t = useTranslations('imageImport');
  const { modal, message } = App.useApp();
  const state = useImageImport();
  const { job, busy, dirty, load, lastId, errorText } = state;
  const router = useRouter();
  const { setGuard } = useNavigationGuard();
  const [provider, setProvider] = useState('deepseek');
  const [priceKind, setPriceKind] = useState<'PURCHASE' | 'SALE'>('PURCHASE');
  const [uploadingImages, setUploadingImages] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [previewSource, setPreviewSource] = useState(false);
  const [tags, setTags] = useState<MaterialTag[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [batches, setBatches] = useState<MaterialBatch[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTarget = useRef<HTMLDivElement>(null);
  const reviewTarget = useRef<HTMLDivElement>(null);

  function resetReviewScroll() {
    const content = reviewTarget.current?.querySelector<HTMLElement>(
      '[data-import-review-content]',
    );
    if (content) content.scrollTop = 0;
  }

  function showSection(target: HTMLDivElement | null) {
    requestAnimationFrame(() => {
      if (!target) return;
      target.focus({ preventScroll: true });
      window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - 24 });
    });
  }

  useEffect(() => {
    const id = initialId ?? lastId();
    if (id) void load(id);
  }, [initialId, lastId, load]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 4000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    Promise.all([
      apiFetch<MaterialCategory[]>('/api/material-categories'),
      apiFetch<MaterialBatch[]>('/api/material-batches'),
      apiFetch<DistributorPage>('/api/distributors'),
      apiFetch<MaterialTag[]>('/api/tags'),
    ])
      .then(([categoryResult, batchResult, distributorResult, tagResult]) => {
        setCategories(categoryResult);
        setTags(tagResult);
        setBatches(batchResult);
        setDistributors(distributorResult.items);
      })
      .catch((error) => message.error(errorText(error)));
  }, [message, errorText]);

  const processing =
    job?.status === 'PROCESSING' && !!job.leaseUntil && new Date(job.leaseUntil).getTime() > now;
  const disabled = busy || processing || uploadingImages || !!sourceFile || !!state.recovery;
  const selected = job?.items.filter((item) => item.data.selected && !item.entryId) ?? [];
  const committed = job?.items.filter((item) => item.entryId).length ?? 0;
  const archived = !!job?.archivedAt;
  const model = state.models.find((item) => item.id === provider);

  const leaveDraft = useCallback(
    async (action: () => void) => {
      if (busy || uploadingImages) {
        message.info(t('waitForOperation'));
        return;
      }
      if (
        (!dirty && !state.recovery) ||
        (await modal.confirm({
          title: t('unsaved'),
          content: t(state.backupFailed ? 'leaveWithoutBackupHelp' : 'leaveWithBackupHelp'),
          okText: t('leaveDraft'),
          cancelText: t('stay'),
        }))
      )
        action();
    },
    [busy, uploadingImages, dirty, state.recovery, state.backupFailed, modal, message, t],
  );

  useEffect(() => {
    setGuard(leaveDraft);
    return () => setGuard(null);
  }, [setGuard, leaveDraft]);

  function confirmSource(file: File) {
    setSourceFile(null);
    modal.confirm({
      title: t('uploadRecognizeConfirm'),
      content: t('sendImageHelp'),
      okText: t('uploadRecognize'),
      cancelText: t('cancel'),
      onOk: () => {
        void state.create(file, provider, job?.settings.priceKind ?? priceKind);
      },
    });
  }

  function apply(patch: Partial<ImportItemData>) {
    state.edit((current) => ({
      ...current,
      items: current.items.map((item) =>
        !item.entryId && item.data.selected && !item.data.existingMaterialId
          ? { ...item, data: patchImportItem(item.data, patch) }
          : item,
      ),
    }));
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <Link
            href="/admin/materials"
            onNavigate={(event) => {
              event.preventDefault();
              void leaveDraft(() => router.push('/admin/materials'));
            }}
          >
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>{t('title')}</h1>
          {!job?.items.length && <p>{t('subtitle')}</p>}
        </div>
        <Space wrap>
          <Button
            icon={<SaveOutlined />}
            disabled={!job || !dirty || disabled || archived}
            onClick={state.save}
          >
            {t('saveDraft')}
          </Button>
          <Popconfirm
            title={t('confirmImport', { count: selected.length })}
            description={t('confirmImportHelp')}
            disabled={!selected.length || disabled || archived}
            onConfirm={async () => {
              await state.commit();
              resetReviewScroll();
            }}
          >
            <Button type="primary" disabled={!selected.length || disabled || archived}>
              {t('importSelected', { count: selected.length })}
            </Button>
          </Popconfirm>
        </Space>
      </div>
      {state.error && (
        <Alert type="error" showIcon message={state.error} className={importStyles.notice} />
      )}
      <ImportValidationFeedback
        validation={state.validation}
        disabled={disabled}
        onSelect={(id) => {
          state.select(id);
          resetReviewScroll();
          showSection(reviewTarget.current);
        }}
        onSettings={() => {
          setSettingsOpen(true);
          showSection(settingsTarget.current);
        }}
      />
      <ImportDraftFeedback state={state} />
      {archived && (
        <Alert type="info" showIcon message={t('archivedNotice')} className={importStyles.notice} />
      )}
      {model && !model.configured && (
        <Alert
          type="info"
          showIcon
          message={t('modelMissing')}
          description={t('modelMissingHelp')}
          className={importStyles.notice}
        />
      )}
      {!job?.items.length && (
        <>
          <Steps
            className={importStyles.steps}
            size="small"
            current={!job ? 0 : job.items.length ? (committed === job.items.length ? 3 : 2) : 1}
            items={[
              { title: t('stepUpload') },
              { title: t('stepRecognize') },
              { title: t('stepReview') },
              { title: t('stepImport') },
            ]}
          />
          <p className={importStyles.hint}>{t('workflowHelp')}</p>
        </>
      )}
      <div className={importStyles.toolbar}>
        <Space wrap>
          <Select
            aria-label={t('model')}
            value={provider}
            disabled={disabled}
            className={importStyles.modelSelect}
            options={
              state.models.length
                ? state.models.map((item) => ({
                    value: item.id,
                    label: `${item.label}${item.model ? ` · ${item.model}` : ''}`,
                    disabled: !item.configured,
                  }))
                : [{ value: 'deepseek', label: 'DeepSeek', disabled: false }]
            }
            onChange={setProvider}
          />
          {!job && (
            <Select
              aria-label={t('defaultPriceKind')}
              value={priceKind}
              disabled={disabled}
              options={[
                { value: 'PURCHASE', label: t('purchase') },
                { value: 'SALE', label: t('sale') },
              ]}
              onChange={setPriceKind}
            />
          )}
          <Upload
            accept="image/jpeg,image/png,image/webp"
            showUploadList={false}
            disabled={disabled || !model?.configured}
            beforeUpload={(file) => {
              void leaveDraft(() => setSourceFile(file));
              return Upload.LIST_IGNORE;
            }}
          >
            <Button
              type="primary"
              icon={<UploadOutlined />}
              disabled={disabled || !model?.configured}
            >
              {t('newImage')}
            </Button>
          </Upload>
          {job && (
            <Popconfirm
              title={job.items.length ? t('rerecognizeConfirm') : t('recognizeConfirm')}
              description={t('sendImageHelp')}
              disabled={disabled || archived || committed > 0 || !model?.configured}
              onConfirm={() => state.recognize(provider)}
            >
              <Button
                icon={<ScanOutlined />}
                disabled={disabled || archived || committed > 0 || !model?.configured}
              >
                {job.items.length ? t('rerecognize') : t('recognize')}
              </Button>
            </Popconfirm>
          )}
        </Space>
        <Space wrap>
          <Select
            aria-label={t('history')}
            placeholder={t('history')}
            value={job?.id}
            className={importStyles.historySelect}
            disabled={disabled}
            options={[
              ...(job && !state.history.some((item) => item.id === job.id)
                ? [{ value: job.id, label: job.fileName }]
                : []),
              ...state.history.map((item) => ({
                value: item.id,
                label: `${item.fileName} · ${t('itemCount', { count: item._count.items })}`,
              })),
            ]}
            onChange={(id) =>
              void leaveDraft(() => {
                void load(id);
              })
            }
          />
          <Button
            danger={!committed}
            icon={committed ? <InboxOutlined /> : <DeleteOutlined />}
            disabled={!job || disabled || archived}
            onClick={() => {
              if (!job) return;
              modal.confirm({
                title: t(committed ? 'archiveRecordConfirm' : 'deleteRecordConfirm'),
                content: t(committed ? 'archiveRecordHelp' : 'deleteRecordHelp', {
                  name: job.fileName,
                }),
                okText: t(committed ? 'archiveRecord' : 'deleteRecord'),
                cancelText: t('cancel'),
                okButtonProps: { danger: !committed },
                autoFocusButton: 'cancel',
                onOk: state.remove,
              });
            }}
          >
            {t(committed ? 'archiveRecord' : 'deleteRecord')}
          </Button>
        </Space>
      </div>
      {state.progress && (
        <Alert type="info" showIcon message={state.progress} className={importStyles.notice} />
      )}
      {job ? (
        <>
          <div className={importStyles.summary}>
            <strong>{job.fileName}</strong>
            <Image.PreviewGroup
              key={job.id}
              items={[{ src: job.sourceUrl, alt: job.fileName }]}
              preview={{ visible: previewSource, onVisibleChange: setPreviewSource }}
            >
              <Button icon={<PictureOutlined />} onClick={() => setPreviewSource(true)}>
                {t('viewSourceImage')}
              </Button>
            </Image.PreviewGroup>
            <span>{t('summary', { count: job.items.length, imported: committed })}</span>
            <Tag>
              {job.provider} · {job.model}
            </Tag>
            <ImportDraftStatus state={state} />
          </div>
          {job.status === 'PROCESSING' && (
            <Alert
              type="info"
              showIcon
              message={t(processing ? 'processing' : 'interrupted')}
              className={importStyles.notice}
            />
          )}
          {job.errorCode && (
            <Alert
              type="warning"
              showIcon
              message={t('previousFailed')}
              description={
                t.has(`errors.${job.errorCode}`) ? t(`errors.${job.errorCode}`) : job.errorCode
              }
              className={importStyles.notice}
            />
          )}
          {!!job.warnings.length && (
            <Alert
              type="warning"
              message={job.warnings.join('；')}
              className={importStyles.notice}
            />
          )}
          <div ref={settingsTarget} tabIndex={-1}>
            <Collapse
              className={importStyles.sharedSettings}
              activeKey={settingsOpen || state.validation?.settings.length ? ['settings'] : []}
              onChange={(keys) => setSettingsOpen(keys.includes('settings'))}
              items={[
                {
                  key: 'settings',
                  label: t('sharedSettings'),
                  extra: (
                    <span className={importStyles.settingsSummary}>
                      {t('supplier')}:{' '}
                      {distributors.find((row) => row.id === job.settings.distributorId)?.name ??
                        t('notSet')}{' '}
                      · {t(job.settings.priceKind === 'PURCHASE' ? 'purchase' : 'sale')}
                    </span>
                  ),
                  children: (
                    <ImportSettings
                      settings={job.settings}
                      categories={categories}
                      distributors={distributors}
                      batches={batches}
                      disabled={disabled || archived || committed > 0}
                      onChange={(settings) => state.edit((current) => ({ ...current, settings }))}
                      onApply={apply}
                    />
                  ),
                },
              ]}
            />
          </div>
          <div ref={reviewTarget} tabIndex={-1}>
            <ImportReviewWorkspace
              key={job.id}
              job={job}
              state={state}
              disabled={disabled}
              provider={provider}
              configured={!!model?.configured}
              categories={categories}
              tags={tags}
              onTagCreated={(tag) =>
                setTags((items) => [...items, tag].sort((a, b) => a.name.localeCompare(b.name)))
              }
              onCategoryCreated={(category) =>
                setCategories((items) =>
                  [...items, category].sort((a, b) => a.name.localeCompare(b.name)),
                )
              }
              onUploadingChange={setUploadingImages}
            />
          </div>
        </>
      ) : (
        <div className={importStyles.empty}>
          <Empty description={t('empty')} />
          <p>{t('emptyHelp')}</p>
        </div>
      )}
      {sourceFile && (
        <ImageCropDialog
          file={sourceFile}
          index={0}
          total={1}
          helpText={t('sourceCropHelp')}
          onCancel={() => setSourceFile(null)}
          onKeep={() => confirmSource(sourceFile)}
          onCrop={confirmSource}
        />
      )}
    </>
  );
}
