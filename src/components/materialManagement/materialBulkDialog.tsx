'use client';

import {
  Alert,
  Button,
  Cascader,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Space,
} from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  DistributorPage,
  MaterialBatch,
  MaterialCategory,
  MaterialSaleRule,
} from '@/lib/client-types';
import {
  bulkUnits,
  materialBulkUpdateSchema,
  type BulkIssue,
  type BulkSale,
  type BulkStock,
  type MaterialBulkPreview,
  type MaterialBulkUpdate,
} from '@/lib/material-bulk';
import { MAX_STOCK } from '@/lib/inventory';
import { DistributorSelect } from '@/components/distributorSelect/distributorSelect';
import { categoryPath, categoryTree } from './categoryTree';
import bulkStyles from './materialBulkDialog.module.css';

type Props = {
  intent: 'edit' | 'delete';
  materialIds: string[];
  categories: MaterialCategory[];
  onClose: () => void;
  onSaved: () => void;
};
type Field = keyof MaterialBulkUpdate['changes'];
type Prices = Extract<BulkSale, { rule: 'CUSTOM_AMOUNT' }>['prices'];

export function MaterialBulkDialog({ intent, materialIds, categories, onClose, onSaved }: Props) {
  const t = useTranslations('materialBulk');
  const editor = useTranslations('materialEditor');
  const materials = useTranslations('materials');
  const common = useTranslations('common');
  const [preview, setPreview] = useState<MaterialBulkPreview | null>(null);
  const [batches, setBatches] = useState<MaterialBatch[]>([]);
  const [distributors, setDistributors] = useState<DistributorPage['items']>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string>();
  const [issues, setIssues] = useState<BulkIssue[]>([]);
  const [stale, setStale] = useState(false);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Partial<Record<Field, boolean>>>({});
  const [categoryId, setCategoryId] = useState<string>();
  const [batchId, setBatchId] = useState<string>();
  const [distributorId, setDistributorId] = useState<string>();
  const [stockMode, setStockMode] = useState<BulkStock['mode']>('SET');
  const [quantities, setQuantities] = useState<BulkStock['quantities']>({});
  const [reason, setReason] = useState('');
  const [saleRule, setSaleRule] = useState<MaterialSaleRule>('COST');
  const [saleValue, setSaleValue] = useState<string>();
  const [prices, setPrices] = useState<Prices>({});

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<MaterialBulkPreview>('/api/materials/bulk/preview', {
        method: 'POST',
        body: JSON.stringify({ materialIds }),
        signal: controller.signal,
      }),
      intent === 'edit'
        ? apiFetch<MaterialBatch[]>('/api/material-batches', { signal: controller.signal })
        : Promise.resolve([]),
      intent === 'edit'
        ? apiFetch<DistributorPage>('/api/distributors', { signal: controller.signal })
        : Promise.resolve({ items: [] }),
    ])
      .then(([data, batchList, distributorPage]) => {
        if (controller.signal.aborted) return;
        setPreview(data);
        setBatches(batchList);
        setDistributors(distributorPage.items);
        setEntryIds((ids) =>
          ids.filter((id) => data.snapshot.entries.some((entry) => entry.id === id)),
        );
        setError(undefined);
        setIssues([]);
        setStale(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof ClientApiError ? err.code : 'SERVER_ERROR');
          setIssues(err instanceof ClientApiError ? (err.issues ?? []) : []);
          setStale(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [intent, materialIds, revision]);

  const entries =
    preview?.items.flatMap((item) => item.batchEntries.map((entry) => ({ item, entry }))) ?? [];
  const targetUnits = bulkUnits.filter((unit) =>
    entries.some(({ item, entry }) => item.unit === unit && entryIds.includes(entry.id)),
  );
  const hasBatchChanges = enabled.stock || enabled.sale || enabled.batchId || enabled.distributorId;
  const canSave =
    !!preview &&
    !loading &&
    !stale &&
    Object.values(enabled).some(Boolean) &&
    (!hasBatchChanges || entryIds.length > 0);
  const blockers = intent === 'delete' ? (preview?.deleteBlockers ?? []) : [];

  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  function field(name: Field, label: string) {
    return (
      <Checkbox
        checked={!!enabled[name]}
        onChange={(event) =>
          setEnabled((current) => ({ ...current, [name]: event.target.checked }))
        }
      >
        {label}
      </Checkbox>
    );
  }
  function issueList(list: BulkIssue[]) {
    return (
      <ul className={bulkStyles.issues}>
        {list.map((issue, index) => {
          const batch = entries.find(({ entry }) => entry.id === issue.entryId)?.entry.batch.name;
          return (
            <li key={`${issue.materialId}:${issue.entryId ?? index}`}>
              {[issue.name, batch].filter(Boolean).join(' / ')}:{' '}
              {t.has(`issues.${issue.code}`) ? t(`issues.${issue.code}` as never) : t('failed')}
            </li>
          );
        })}
      </ul>
    );
  }
  const feedback = error && (
    <Alert
      type="error"
      showIcon
      message={
        error === 'BULK_CHANGED'
          ? t('changed')
          : error === 'BULK_FAILED'
            ? t('failed')
            : error === 'FORM_INVALID'
              ? t('formInvalid')
              : common(`errors.${error}` as never)
      }
      description={issues.length ? issueList(issues) : undefined}
      action={
        <Button size="small" disabled={saving || loading} onClick={refresh}>
          {t('refresh')}
        </Button>
      }
    />
  );

  async function submit() {
    if (!preview || saving) return;
    let body: unknown = { snapshot: preview.snapshot };
    if (intent === 'edit') {
      const changes: Record<string, unknown> = {};
      if (enabled.categoryId) changes.categoryId = categoryId ?? '';
      if (enabled.batchId) changes.batchId = batchId ?? '';
      if (enabled.distributorId) changes.distributorId = distributorId ?? '';
      if (enabled.stock) changes.stock = { mode: stockMode, quantities, reason };
      if (enabled.sale)
        changes.sale =
          saleRule === 'CUSTOM_AMOUNT'
            ? { rule: saleRule, prices }
            : saleRule === 'FIXED_AMOUNT' || saleRule === 'CUSTOM_PERCENT'
              ? { rule: saleRule, value: saleValue ?? '' }
              : { rule: saleRule };
      const parsed = materialBulkUpdateSchema.safeParse({
        snapshot: preview.snapshot,
        entryIds,
        changes,
      });
      if (
        !parsed.success ||
        (enabled.stock && targetUnits.some((unit) => quantities[unit] === undefined)) ||
        (enabled.sale &&
          saleRule === 'CUSTOM_AMOUNT' &&
          targetUnits.some(
            (unit) => !Object.values(prices[unit] ?? {}).some((value) => value !== undefined),
          ))
      ) {
        setError('FORM_INVALID');
        setIssues([]);
        return;
      }
      body = parsed.data;
    }
    setSaving(true);
    try {
      await apiFetch('/api/materials/bulk', {
        method: intent === 'edit' ? 'PATCH' : 'DELETE',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.code : 'SERVER_ERROR');
      setIssues(err instanceof ClientApiError ? (err.issues ?? []) : []);
      if (err instanceof ClientApiError && err.code === 'BULK_CHANGED') setStale(true);
      // A lost response may have followed a successful commit. Refresh before a manual retry.
      if (!(err instanceof ClientApiError)) {
        setStale(true);
        setError('BULK_CHANGED');
      }
    } finally {
      setSaving(false);
    }
  }

  const summary = preview && (
    <p>
      {t('summary', {
        materials: preview.items.length,
        entries: intent === 'delete' ? entries.length : entryIds.length,
      })}
    </p>
  );
  if (intent === 'delete')
    return (
      <Modal
        open
        title={t('deleteTitle')}
        onCancel={() => !saving && onClose()}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
        okText={common('delete')}
        cancelText={common('cancel')}
        okButtonProps={{
          danger: true,
          disabled: loading || !preview || stale || blockers.length > 0,
        }}
        cancelButtonProps={{ disabled: saving }}
        confirmLoading={saving}
        onOk={() => void submit()}
      >
        {loading ? (
          <Skeleton active />
        ) : (
          <>
            {summary}
            <p>{t('deleteWarning')}</p>
            {!!blockers.length && (
              <Alert
                type="warning"
                showIcon
                message={t('deleteBlocked')}
                description={issueList(blockers)}
              />
            )}
          </>
        )}
        {feedback}
      </Modal>
    );

  return (
    <Drawer
      open
      title={t('editTitle')}
      width="min(760px, 100vw)"
      onClose={() => !saving && onClose()}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      footer={
        <div className={bulkStyles.footer}>
          <Button disabled={saving} onClick={onClose}>
            {common('cancel')}
          </Button>
          <Button type="primary" loading={saving} disabled={!canSave} onClick={() => void submit()}>
            {common('save')}
          </Button>
        </div>
      }
    >
      <div className={bulkStyles.content}>
        {feedback}
        {loading ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : (
          preview && (
            <Form layout="vertical" disabled={saving}>
              {summary}
              <section className={bulkStyles.section}>
                {field('categoryId', t('category'))}
                {enabled.categoryId && (
                  <Cascader
                    className={bulkStyles.input}
                    options={categoryTree(categories)}
                    value={categoryId ? categoryPath(categoryId, categories) : []}
                    onChange={(path) => setCategoryId(path?.at(-1) as string | undefined)}
                    showSearch
                    changeOnSelect
                    placeholder={t('category')}
                  />
                )}
              </section>
              <section className={bulkStyles.section}>
                <div className={bulkStyles.heading}>
                  <strong>{t('targets')}</strong>
                  <Space>
                    <Button
                      size="small"
                      disabled={!entries.length}
                      onClick={() => setEntryIds(entries.map(({ entry }) => entry.id))}
                    >
                      {t('selectAll')}
                    </Button>
                    <Button
                      size="small"
                      disabled={!entryIds.length}
                      onClick={() => setEntryIds([])}
                    >
                      {t('clear')}
                    </Button>
                  </Space>
                </div>
                <p className={bulkStyles.hint}>{t('targetsHint')}</p>
                <div className={bulkStyles.targets}>
                  {preview.items.map((item) => (
                    <div className={bulkStyles.material} key={item.id}>
                      <strong>
                        {item.name} · {materials(item.unit)}
                      </strong>
                      {!item.batchEntries.length && (
                        <span className={bulkStyles.hint}>{t('noEntries')}</span>
                      )}
                      {item.batchEntries.map((entry) => (
                        <Checkbox
                          key={entry.id}
                          checked={entryIds.includes(entry.id)}
                          onChange={(event) =>
                            setEntryIds((ids) =>
                              event.target.checked
                                ? [...ids, entry.id]
                                : ids.filter((id) => id !== entry.id),
                            )
                          }
                        >
                          {entry.batch.name} ·{' '}
                          {t('remaining', { quantity: entry.remainingQty ?? t('unknown') })}{' '}
                          {materials(item.unit)} · {entry.distributor.name}
                        </Checkbox>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
              <section className={bulkStyles.section}>
                {field('stock', t('stock'))}
                {enabled.stock && (
                  <>
                    <Select
                      className={bulkStyles.input}
                      aria-label={t('stockMode')}
                      value={stockMode}
                      onChange={setStockMode}
                      options={(['SET', 'ADD', 'SUBTRACT'] as const).map((value) => ({
                        value,
                        label: t(value),
                      }))}
                    />
                    {!targetUnits.length && <p className={bulkStyles.hint}>{t('chooseTargets')}</p>}
                    <div className={bulkStyles.grid}>
                      {targetUnits.map((unit) => (
                        <Form.Item key={unit} label={materials(unit)} required>
                          <InputNumber
                            aria-label={`${t('stock')} ${materials(unit)}`}
                            className={bulkStyles.input}
                            min={0}
                            max={MAX_STOCK}
                            precision={unit === 'GRAM' ? 2 : 0}
                            step={unit === 'GRAM' ? 0.01 : 1}
                            value={quantities[unit]}
                            onChange={(value) =>
                              setQuantities((current) => ({
                                ...current,
                                [unit]: value ?? undefined,
                              }))
                            }
                          />
                        </Form.Item>
                      ))}
                    </div>
                    <Input.TextArea
                      aria-label={t('reason')}
                      placeholder={t('reason')}
                      value={reason}
                      maxLength={500}
                      rows={2}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </>
                )}
              </section>
              <section className={bulkStyles.section}>
                {field('sale', t('sale'))}
                {enabled.sale && (
                  <>
                    <Select
                      className={bulkStyles.input}
                      aria-label={t('sale')}
                      value={saleRule}
                      onChange={setSaleRule}
                      options={(
                        [
                          'COST',
                          'PERCENT_30',
                          'PERCENT_50',
                          'PERCENT_60',
                          'FIXED_AMOUNT',
                          'CUSTOM_PERCENT',
                          'CUSTOM_AMOUNT',
                        ] as const
                      ).map((value) => ({ value, label: editor(`rule_${value}`) }))}
                    />
                    {(saleRule === 'FIXED_AMOUNT' || saleRule === 'CUSTOM_PERCENT') && (
                      <InputNumber<string>
                        aria-label={t('ruleValue')}
                        stringMode
                        className={bulkStyles.input}
                        min="0"
                        precision={2}
                        value={saleValue}
                        addonAfter={saleRule === 'CUSTOM_PERCENT' ? '%' : '¥'}
                        onChange={(value) => setSaleValue(value ?? undefined)}
                      />
                    )}
                    {saleRule !== 'CUSTOM_AMOUNT' ? (
                      <p className={bulkStyles.hint}>{t('repriceWarning')}</p>
                    ) : (
                      <>
                        <p className={bulkStyles.hint}>{t('customPriceHint')}</p>
                        {targetUnits.map((unit) => (
                          <div key={unit}>
                            <strong>{materials(unit)}</strong>
                            <div className={bulkStyles.grid}>
                              {(unit === 'GRAM'
                                ? (['saleGramPrice'] as const)
                                : unit === 'STRAND'
                                  ? ([
                                      'saleUnitPrice',
                                      'saleGramPrice',
                                      'saleChildUnitPrice',
                                    ] as const)
                                  : (['saleUnitPrice', 'saleGramPrice'] as const)
                              ).map((key) => (
                                <Form.Item key={key} label={editor(key)}>
                                  <InputNumber<string>
                                    aria-label={`${materials(unit)} ${editor(key)}`}
                                    stringMode
                                    min="0"
                                    precision={2}
                                    className={bulkStyles.input}
                                    value={
                                      (prices[unit] as Record<string, string> | undefined)?.[key]
                                    }
                                    onChange={(value) =>
                                      setPrices((current) => ({
                                        ...current,
                                        [unit]: { ...current[unit], [key]: value ?? undefined },
                                      }))
                                    }
                                  />
                                </Form.Item>
                              ))}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </section>
              <section className={bulkStyles.section}>
                {field('batchId', t('batch'))}
                {enabled.batchId && (
                  <>
                    <Select
                      aria-label={t('batch')}
                      className={bulkStyles.input}
                      showSearch
                      optionFilterProp="label"
                      value={batchId}
                      onChange={setBatchId}
                      placeholder={t('batch')}
                      options={batches.map((batch) => ({ value: batch.id, label: batch.name }))}
                    />
                    <p className={bulkStyles.hint}>{t('batchHint')}</p>
                  </>
                )}
              </section>
              <section className={bulkStyles.section}>
                {field('distributorId', t('distributor'))}
                {enabled.distributorId && (
                  <DistributorSelect
                    aria-label={t('distributor')}
                    className={bulkStyles.input}
                    distributors={distributors}
                    value={distributorId}
                    onChange={setDistributorId}
                    placeholder={t('distributor')}
                  />
                )}
              </section>
            </Form>
          )
        )}
      </div>
    </Drawer>
  );
}
