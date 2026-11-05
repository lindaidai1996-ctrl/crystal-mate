'use client';

import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Popconfirm,
  Result,
  Select,
  Space,
  Steps,
  Skeleton,
  Tag,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  ScanOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { withAdminReturnTo } from '@/lib/admin-return-path';
import {
  newDiyPart,
  patchDiyPart,
  diySource,
  MAX_DIY_IMAGES,
  type DiyData,
} from '@/lib/diyImageImport/contracts';
import { calculateDiyCost } from '@/lib/product-diy-cost';
import { useDiyImport } from './useDiyImport';
import { DiySettings } from './diySettings';
import { DiyImageCanvas } from './diyImageCanvas';
import { DiyPartEditor } from './diyPartEditor';
import styles from './diyImport.module.css';

export function DiyImportPage({
  initialId,
  targetProductId,
  returnTo,
}: {
  initialId?: string;
  targetProductId?: string;
  returnTo?: string;
}) {
  const t = useTranslations('diyImport');
  const state = useDiyImport(initialId);
  const { job, busy, dirty, error, models, history } = state;
  const [provider, setProvider] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const [imageId, setImageId] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const model =
    models.find((model) => model.id === provider) ??
    models.find((model) => model.configured) ??
    models[0];
  const configured = !!model?.configured;
  const committed = job?.status === 'COMMITTED';
  const processing =
    job?.status === 'PROCESSING' && !!job.leaseUntil && new Date(job.leaseUntil) > new Date();
  const disabled = busy || committed || processing;
  const active =
    job?.data.parts.find((part) => part.id === activeId) ??
    job?.data.parts.find((part) => !part.excluded);
  const image = job?.images.find((image) => image.id === imageId) ?? job?.images[0];
  const source = job ? diySource(job.data, false) : null;
  const cost = source ? calculateDiyCost(source) : null;
  const reviewedSource = job ? diySource(job.data) : null;
  const included = job?.data.parts.filter((part) => !part.excluded) ?? [];
  const reviewed = included.filter((part) => part.reviewed).length;
  const ready =
    !!reviewedSource &&
    !!cost &&
    !!job &&
    (job.data.targetProductId ||
      (job.data.name.trim() && job.data.categoryId && job.data.code && job.data.salePrice));
  function patchData(patch: Partial<DiyData>) {
    state.edit((current) => ({ ...current, data: { ...current.data, ...patch } }));
  }
  function selectPart(id: string) {
    setActiveId(id);
    const part = job?.data.parts.find((part) => part.id === id);
    if (part?.views.length && !part.views.some((view) => view.imageId === image?.id))
      setImageId(part.views[0].imageId);
  }
  function addPart() {
    const part = newDiyPart();
    patchData({ parts: [...job!.data.parts, part] });
    setActiveId(part.id);
  }
  function mergePart(fromId: string, toId: string) {
    state.edit((current) => {
      const from = current.data.parts.find((part) => part.id === fromId)!;
      return {
        ...current,
        data: {
          ...current.data,
          parts: current.data.parts
            .filter((part) => part.id !== fromId)
            .map((part) =>
              part.id !== toId
                ? part
                : patchDiyPart(part, {
                    views: [
                      ...part.views,
                      ...from.views.filter(
                        (view) => !part.views.some((old) => old.imageId === view.imageId),
                      ),
                    ],
                    quantity: '',
                    reviewed: false,
                    warnings: [...part.warnings, t('mergeWarning')].slice(-10),
                  }),
            ),
        },
      };
    });
    setActiveId(toId);
  }
  if (state.loading) return <Skeleton active paragraph={{ rows: 12 }} />;
  return (
    <>
      <div className="page-heading">
        <div>
          <Link
            href={
              returnTo ??
              (job?.data.targetProductId
                ? `/admin/products/${job.data.targetProductId}`
                : '/admin/products')
            }
            className="back-link"
          >
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <Button
          disabled={busy || processing}
          onClick={() => void state.reset()}
          icon={<PlusOutlined />}
        >
          {t('newDraft')}
        </Button>
      </div>
      <Steps
        size="small"
        current={committed ? 3 : job?.data.parts.length ? 1 : job ? 1 : 0}
        className={styles.notice}
        items={[{ title: t('stepUpload') }, { title: t('stepReview') }, { title: t('stepCommit') }]}
      />
      <div className={styles.toolbar}>
        <Space wrap>
          <Select
            className={styles.model}
            aria-label={t('model')}
            value={model?.id}
            disabled={disabled}
            onChange={setProvider}
            options={models.map((item) => ({
              value: item.id,
              label: `${item.label} · ${item.model || '—'}`,
              disabled: !item.configured,
            }))}
          />
          <Tag>{t('draftOnly')}</Tag>
          {job && <Tag color={dirty ? 'warning' : 'success'}>{t(dirty ? 'unsaved' : 'saved')}</Tag>}
        </Space>
        <Select
          className={styles.history}
          aria-label={t('history')}
          placeholder={t('history')}
          value={job?.id}
          disabled={busy || processing}
          options={history.map((item) => ({
            value: item.id,
            label: `${item.name || t('unnamedDraft')} · ${t(item.status === 'COMMITTED' ? 'committed' : 'draft')}`,
          }))}
          onChange={(id) => {
            setActiveId(undefined);
            setImageId(undefined);
            void state.load(id);
          }}
        />
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          className={styles.notice}
          action={
            job && (
              <Popconfirm
                title={t('reloadConfirm')}
                disabled={!dirty}
                onConfirm={() => void state.load(job.id, true)}
              >
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    if (!dirty) void state.load(job.id, true);
                  }}
                >
                  {t('reload')}
                </Button>
              </Popconfirm>
            )
          }
        />
      )}
      {!configured && (
        <Alert showIcon type="info" message={t('modelMissing')} className={styles.notice} />
      )}
      <input
        ref={input}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void state.addImages(files, targetProductId);
        }}
      />
      {!job ? (
        <div className={`${styles.surface} ${styles.upload}`}>
          <UploadOutlined style={{ fontSize: 36, color: 'var(--ant-color-primary)' }} />
          <div>
            <h2>{t('uploadTitle')}</h2>
            <p className={styles.muted}>{t('uploadHint')}</p>
          </div>
          <Button
            type="primary"
            loading={busy}
            icon={<UploadOutlined />}
            onClick={() => input.current?.click()}
          >
            {t('upload')}
          </Button>
        </div>
      ) : (
        <>
          {committed && (
            <Result
              status="success"
              title={t('commitSuccess')}
              subTitle={t('commitSuccessHint')}
              extra={
                <Link
                  href={withAdminReturnTo(
                    `/admin/products/${job.productId}`,
                    returnTo ?? '/admin/products',
                  )}
                >
                  <Button type="primary">{t('viewProduct')}</Button>
                </Link>
              }
            />
          )}
          {processing && (
            <Alert type="info" showIcon message={t('processing')} className={styles.notice} />
          )}
          {job.errorCode && !error && (
            <Alert
              type="warning"
              showIcon
              message={state.errorText(new Error(job.errorCode))}
              className={styles.notice}
            />
          )}
          {!!job.warnings.length && (
            <Alert
              type="warning"
              showIcon
              message={t('recognitionWarnings')}
              description={
                <ul>
                  {job.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              }
              className={styles.notice}
            />
          )}
          <DiySettings data={job.data} disabled={disabled} onPatch={patchData} />
          <div className={styles.toolbar}>
            <Space wrap>
              <Button
                icon={<UploadOutlined />}
                disabled={disabled || job.images.length >= MAX_DIY_IMAGES}
                onClick={() => input.current?.click()}
              >
                {t('addImages')}
              </Button>
              <Popconfirm
                title={t('recognizeConfirm')}
                disabled={disabled || !configured}
                onConfirm={() => void state.recognize(model!.id)}
              >
                <Button icon={<ScanOutlined />} disabled={disabled || !configured} loading={busy}>
                  {t('recognize')}
                </Button>
              </Popconfirm>
              <Button
                icon={<PlusOutlined />}
                disabled={disabled || job.data.parts.length >= 50}
                onClick={addPart}
              >
                {t('addPart')}
              </Button>
            </Space>
            <span className={styles.muted}>
              {t('reviewProgress', { reviewed, count: included.length })}
            </span>
          </div>
          <div className={styles.workspace}>
            <aside className={styles.photoColumn}>
              <div className={styles.photos}>
                {job.images.map((item, index) => (
                  <Button
                    key={item.id}
                    type={image?.id === item.id ? 'primary' : 'default'}
                    className={styles.photoTab}
                    title={item.fileName}
                    onClick={() => setImageId(item.id)}
                  >
                    {t('photoNumber', { number: index + 1 })}
                  </Button>
                ))}
              </div>
              {image && (
                <DiyImageCanvas
                  key={image.id}
                  image={image}
                  parts={job.data.parts}
                  activeId={active?.id}
                  disabled={disabled}
                  onSelect={selectPart}
                  onBox={(box) => {
                    if (!active) return;
                    patchData({
                      parts: job.data.parts.map((part) =>
                        part.id !== active.id
                          ? part
                          : patchDiyPart(part, {
                              views: [
                                ...part.views.filter((view) => view.imageId !== image.id),
                                { imageId: image.id, box },
                              ],
                            }),
                      ),
                    });
                  }}
                />
              )}
              {image && job.images.length > 1 && (
                <Popconfirm
                  title={t('removeImageConfirm')}
                  disabled={disabled}
                  onConfirm={() => {
                    state.edit((current) => ({
                      ...current,
                      images: current.images.filter((item) => item.id !== image.id),
                      data: {
                        ...current.data,
                        parts: current.data.parts.map((part) =>
                          part.views.some((view) => view.imageId === image.id)
                            ? patchDiyPart(part, {
                                views: part.views.filter((view) => view.imageId !== image.id),
                              })
                            : part,
                        ),
                      },
                    }));
                    setImageId(undefined);
                  }}
                >
                  <Button type="text" disabled={disabled} icon={<DeleteOutlined />}>
                    {t('removeImage')}
                  </Button>
                </Popconfirm>
              )}
              <p className={styles.muted}>{t('photoHint')}</p>
            </aside>
            <section className={styles.parts} aria-label={t('parts')}>
              {!job.data.parts.length && (
                <div className={styles.surface}>
                  <Empty description={t('emptyParts')} />
                </div>
              )}
              {job.data.parts.map((part, index) => (
                <DiyPartEditor
                  key={`${job.id}:${part.id}`}
                  part={part}
                  number={index + 1}
                  active={part.id === active?.id}
                  disabled={disabled}
                  configured={configured}
                  onSelect={() => selectPart(part.id)}
                  onPatch={(patch) =>
                    state.edit((current) => ({
                      ...current,
                      data: {
                        ...current.data,
                        parts: current.data.parts.map((item) =>
                          item.id === part.id ? patchDiyPart(item, patch) : item,
                        ),
                      },
                    }))
                  }
                  onDelete={() =>
                    patchData({ parts: job.data.parts.filter((item) => item.id !== part.id) })
                  }
                  onRecognize={() => void state.recognize(model!.id, part.id)}
                  mergeTargets={job.data.parts
                    .filter((item) => item.id !== part.id && !item.excluded)
                    .map((item) => ({ value: item.id, label: item.name || t('unnamedPart') }))}
                  onMerge={(id) => mergePart(part.id, id)}
                />
              ))}
            </section>
          </div>
          {!committed && (
            <footer className={styles.footer}>
              <div className={styles.cost}>
                <div>
                  <span className={styles.muted}>{t('perUnitCost')}</span>
                  <strong>{cost ? `¥${cost.perUnitCost}` : '—'}</strong>
                </div>
                <div>
                  <span className={styles.muted}>{t('totalCost')}</span>
                  <strong>{cost ? `¥${cost.totalCost}` : '—'}</strong>
                </div>
              </div>
              <Space wrap>
                <Popconfirm
                  title={t('deleteDraftConfirm')}
                  disabled={disabled}
                  onConfirm={() => void state.remove()}
                >
                  <Button disabled={disabled} icon={<DeleteOutlined />}>
                    {t('deleteDraft')}
                  </Button>
                </Popconfirm>
                <Button
                  disabled={disabled || !dirty}
                  icon={<SaveOutlined />}
                  onClick={() =>
                    void state.run(async () => {
                      await state.save();
                    })
                  }
                >
                  {t('save')}
                </Button>
                <Popconfirm
                  title={t('commitConfirm', { quantity: job.data.quantity })}
                  description={t('stockHint')}
                  disabled={disabled || !ready}
                  onConfirm={() => void state.commit()}
                >
                  <Button type="primary" disabled={disabled || !ready} loading={busy}>
                    {t('commit')}
                  </Button>
                </Popconfirm>
              </Space>
              {!ready && (
                <span className={`${styles.muted} ${styles.wide}`}>{t('incompleteHint')}</span>
              )}
            </footer>
          )}
        </>
      )}
    </>
  );
}
