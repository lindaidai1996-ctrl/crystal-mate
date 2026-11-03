'use client';

import { PictureOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Empty, Image, Skeleton, Tag } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Material, MaterialImageImportSource } from '@/lib/client-types';
import sourceStyles from './materialImportSources.module.css';

export function MaterialImportSources({ material }: { material: Material }) {
  const t = useTranslations('materialImportSources');
  const common = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<MaterialImageImportSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<number>();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    apiFetch<MaterialImageImportSource[]>(`/api/materials/${material.id}/image-imports`, {
      signal: controller.signal,
    })
      .then((items) => {
        if (!controller.signal.aborted) setSources(items);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            common(
              `errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never,
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, material.id, revision, common]);

  if (!material.imageImportCount) return null;

  return (
    <>
      <button
        type="button"
        aria-label={t('badge', { count: material.imageImportCount })}
        className={sourceStyles.badge}
        onClick={() => {
          setLoading(true);
          setError(null);
          setOpen(true);
        }}
      >
        <PictureOutlined />
        {t('badge', { count: material.imageImportCount })}
      </button>
      <Drawer
        title={<span className={sourceStyles.title}>{t('title', { name: material.name })}</span>}
        open={open}
        width="min(600px, 100vw)"
        styles={{
          body: {
            padding: 'clamp(16px, 4vw, 24px)',
            background: 'var(--ant-color-bg-layout, #f5f7fa)',
          },
        }}
        keyboard={preview === undefined}
        onClose={() => {
          setPreview(undefined);
          setOpen(false);
        }}
      >
        <p className={sourceStyles.help}>{t('help')}</p>
        {loading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            action={
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  setRevision((value) => value + 1);
                }}
              >
                {t('retry')}
              </Button>
            }
          />
        ) : !sources.length ? (
          <Empty description={t('empty')} />
        ) : (
          <Image.PreviewGroup
            items={sources.map((source) => ({ src: source.sourceUrl, alt: source.fileName }))}
            preview={{
              visible: preview !== undefined,
              current: preview ?? 0,
              onVisibleChange: (visible) => {
                if (!visible) setPreview(undefined);
              },
              onChange: setPreview,
            }}
          >
            <div className={sourceStyles.list}>
              {sources.map((source, index) => (
                <article key={source.itemId} className={sourceStyles.source}>
                  <div className={sourceStyles.heading}>
                    <span className={sourceStyles.fileIcon} aria-hidden="true">
                      <PictureOutlined />
                    </span>
                    <strong className={sourceStyles.fileName}>{source.fileName}</strong>
                    {source.archivedAt && <Tag>{t('archived')}</Tag>}
                  </div>
                  <dl className={sourceStyles.details}>
                    <dt>{t('importedAt')}</dt>
                    <dd>{new Date(source.importedAt).toLocaleString()}</dd>
                    <dt>{t('receivedAt')}</dt>
                    <dd>{new Date(source.receivedAt).toLocaleString()}</dd>
                    <dt>{t('supplier')}</dt>
                    <dd>{source.distributor.name}</dd>
                    <dt>{t('batch')}</dt>
                    <dd>
                      <Link href={`/admin/materials/batches/${source.batch.id}`}>
                        {source.batch.name}
                      </Link>
                    </dd>
                  </dl>
                  <div className={sourceStyles.actions}>
                    <Button
                      type="primary"
                      icon={<PictureOutlined />}
                      onClick={() => setPreview(index)}
                    >
                      {t('viewImage')}
                    </Button>
                    <Link
                      className={sourceStyles.entryLink}
                      href={`/admin/materials/${material.id}/batches/${source.entryId}`}
                    >
                      {t('viewEntry')}
                    </Link>
                    <Link
                      className={sourceStyles.recordLink}
                      href={`/admin/materials/image-import?import=${source.importId}`}
                    >
                      {t('viewImport')}
                      <RightOutlined aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </Drawer>
    </>
  );
}
