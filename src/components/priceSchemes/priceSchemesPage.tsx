'use client';
import { useEffect, useState } from 'react';
import { Alert, App, Button, Empty, Skeleton, Table } from 'antd';
import { useTranslations } from 'next-intl';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { usePrivacyMode } from '../privacyMode';
import { ResponsiveDrawer as Drawer } from '../responsive/responsiveDialog';
import {
  schemeInputSchema,
  type PriceScheme,
  type SchemeImpact as Impact,
  type SchemeInput,
} from '@/lib/price-schemes/contracts';
import { SchemeFormulaEditor } from './schemeFormulaEditor';
import { SchemeImpact } from './schemeImpact';
import css from './priceSchemes.module.css';
const empty: SchemeInput = {
  name: '',
  formula: 'direct / (1 - 5%)',
  rounding: 'CENT',
  common: false,
  position: 0,
};
export function PriceSchemesPage() {
  const t = useTranslations('priceSchemes');
  const common = useTranslations('common');
  const privacy = usePrivacyMode();
  const { message, modal } = App.useApp();
  const [schemes, setSchemes] = useState<PriceScheme[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PriceScheme | null>(null);
  const [draft, setDraft] = useState<SchemeInput>(empty);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<PriceScheme[]>('/api/price-schemes', { signal: controller.signal })
      .then((value) => {
        setSchemes(value);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [revision]);
  function edit(scheme: PriceScheme | null) {
    setEditing(scheme);
    setDraft(
      scheme
        ? {
            name: scheme.name,
            formula: scheme.formula,
            rounding: scheme.rounding,
            common: scheme.common,
            position: scheme.position,
          }
        : empty,
    );
    setImpact(null);
    setExcluded([]);
    setDirty(false);
    setOpen(true);
  }
  function close() {
    if (busy) return;
    if (dirty)
      modal.confirm({
        title: t('discard'),
        okText: t('discardConfirm'),
        cancelText: common('cancel'),
        onOk: () => setOpen(false),
      });
    else setOpen(false);
  }
  const change = { id: editing?.id, expectedVersion: editing?.version, input: draft };
  function errorMessage(error: unknown) {
    return error instanceof ClientApiError && error.code === 'SCHEME_PRICE_CHANGED'
      ? t('changed')
      : error instanceof ClientApiError && error.code === 'DUPLICATE'
        ? t('duplicate')
        : common('errors.SERVER_ERROR');
  }
  async function preview() {
    setBusy(true);
    try {
      setImpact(
        await apiFetch<Impact>('/api/price-schemes/preview', {
          method: 'POST',
          body: JSON.stringify(change),
        }),
      );
      setExcluded([]);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!impact) return;
    setBusy(true);
    try {
      const result = await apiFetch<{
        counts: { updated: number; retained: number; invalid: number };
      }>('/api/price-schemes/commit', {
        method: 'POST',
        body: JSON.stringify({ ...change, token: impact.token, excludedIds: excluded }),
      });
      message.success(t('saved', result.counts));
      setOpen(false);
      setRevision((value) => value + 1);
    } catch (error) {
      message.error(errorMessage(error));
      setImpact(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={css.workspace}>
      <div className={css.heading}>
        <div>
          <h1>{t('title')}</h1>
          <p className={css.muted}>{t('description')}</p>
        </div>
        <Button type="primary" disabled={privacy} onClick={() => edit(null)}>
          {t('create')}
        </Button>
      </div>
      {privacy && <Alert type="info" message={t('privacyHelp')} />}
      {failed ? (
        <Alert
          type="error"
          message={t('loadFailed')}
          action={<Button onClick={() => setRevision((value) => value + 1)}>{t('retry')}</Button>}
        />
      ) : !schemes ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : !schemes.length ? (
        <Empty description={t('noSchemes')} />
      ) : (
        <div className={css.table}>
          <Table
            rowKey="id"
            dataSource={schemes}
            scroll={{ x: 700 }}
            pagination={{ pageSize: 20 }}
            columns={[
              { title: t('name'), dataIndex: 'name' },
              ...(!privacy
                ? [
                    {
                      title: t('formula'),
                      key: 'formula',
                      render: (_: unknown, row: PriceScheme) => (
                        <span className={css.formula}>{row.formula}</span>
                      ),
                    },
                  ]
                : []),
              { title: t('rounding'), key: 'rounding', render: (_, row) => t(row.rounding) },
              {
                title: t('common'),
                key: 'common',
                render: (_, row) => (row.common ? t('yes') : '—'),
              },
              { title: t('position'), dataIndex: 'position' },
              { title: t('usage'), key: 'usage', render: (_, row) => row._count?.prices ?? 0 },
              {
                title: t('edit'),
                key: 'edit',
                render: (_, row) => (
                  <Button disabled={privacy} onClick={() => edit(row)}>
                    {t('edit')}
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}
      <Drawer
        width="min(960px, 100vw)"
        title={impact ? t('review') : editing ? t('edit') : t('create')}
        open={open}
        onClose={close}
        maskClosable={!busy}
        keyboard={!busy}
        footer={
          <div className={css.actions}>
            <Button disabled={busy} onClick={impact ? () => setImpact(null) : close}>
              {impact ? t('back') : common('cancel')}
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={privacy || !schemeInputSchema.safeParse(draft).success}
              onClick={() => void (impact ? commit() : preview())}
            >
              {impact ? t('confirm') : t('preview')}
            </Button>
          </div>
        }
      >
        {privacy ? (
          <Alert type="info" message={t('privacyHelp')} />
        ) : impact ? (
          <SchemeImpact impact={impact} excluded={excluded} onChange={setExcluded} />
        ) : (
          <SchemeFormulaEditor
            value={draft}
            onChange={(value) => {
              setDraft(value);
              setDirty(true);
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
