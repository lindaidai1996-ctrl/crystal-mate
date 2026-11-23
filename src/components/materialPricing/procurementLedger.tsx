'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, App, Button, Input, InputNumber, Select, Table, Tag } from 'antd';
import { PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { DateInput } from '@/components/date-input';
import { DateRangeFilter } from '@/components/date-range-filter';
import type { DateRange } from '@/lib/date-range';
import {
  filterProcurementRows,
  procurementSupplierOptions,
} from '@/lib/material-pricing/analytics';
import { MaterialPricingNavigation } from './materialPricingNavigation';
import { ResponsiveDrawer } from '@/components/responsive/responsiveDialog';
import { Sensitive, usePrivacyMode } from '@/components/privacyMode';
import {
  procurementSchema,
  procurementMetrics,
  amountFromDiscount,
  summarizeProcurement,
  type ProcurementInput,
  type ProcurementRow,
} from '@/lib/material-pricing/purchase-contracts';
import type { ProcurementCatalog } from '@/lib/material-pricing/purchase-service';
import { SilverImportWorkspace } from './silverImportWorkspace';
import ledgerStyles from './procurementLedger.module.css';

export function ProcurementLedger({
  initialGroupId,
  onSaved,
  standalone = false,
}: {
  initialGroupId?: string;
  onSaved?: () => void;
  standalone?: boolean;
}) {
  const t = useTranslations('silverProcurement'),
    common = useTranslations('common');
  const { message, modal } = App.useApp();
  const pathname = usePathname();
  const router = useRouter();
  const privacy = usePrivacyMode();
  const [data, setData] = useState<ProcurementCatalog>({
    items: [],
    materials: [],
    distributors: [],
    groups: [],
    categories: [],
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [localGroup, setGroup] = useState(initialGroupId ?? '');
  const group = standalone ? (initialGroupId ?? '') : localGroup;
  const changeGroup = (value: string) => {
    if (standalone)
      router.replace({ pathname, query: value ? { group: value } : {} }, { scroll: false });
    else setGroup(value);
  };
  const [supplier, setSupplier] = useState('');
  const [dates, setDates] = useState<DateRange>(null);
  const [aggregate, setAggregate] = useState<'none' | 'month' | 'distributor'>('none');
  const [editor, setEditor] = useState<{
    id?: string;
    fingerprint?: string;
    draft: ProcurementInput;
  }>();
  const [busy, setBusy] = useState(false),
    [importOpen, setImportOpen] = useState(false);
  const [importDirty, setImportDirty] = useState(false);
  const errorText = useCallback(
    (error: unknown) => {
      const code = error instanceof ClientApiError ? error.code : 'SERVER_ERROR';
      return t.has(`errors.${code}`)
        ? t(`errors.${code}`)
        : common.has(`errors.${code}`)
          ? common(`errors.${code}`)
          : common('errors.SERVER_ERROR');
    },
    [t, common],
  );
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ProcurementCatalog>('/api/material-pricing-purchases', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError('');
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, errorText]);
  const refresh = () => {
    setLoading(true);
    setRevision((value) => value + 1);
  };
  const changed = () => {
    refresh();
    onSaved?.();
  };
  const scopedRows = useMemo(
    () => filterProcurementRows(data.items, { groupId: group, dates }),
    [data.items, group, dates],
  );
  const filterSupplierOptions = useMemo(() => procurementSupplierOptions(scopedRows), [scopedRows]);
  const activeSupplier = filterSupplierOptions.some((item) => item.value === supplier)
    ? supplier
    : '';
  const rows = useMemo(
    () => filterProcurementRows(scopedRows, { distributorId: activeSupplier }),
    [scopedRows, activeSupplier],
  );
  const groups = data.groups.map((item) => ({ value: item.id, label: item.name }));
  const materialOptions = data.materials.map((item) => ({
    value: item.id,
    label: `${item.pricingGroup!.name} · ${item.name}`,
  }));
  const supplierOptions = data.distributors.map((item) => ({ value: item.id, label: item.name }));
  const patchDraft = (patch: Partial<ProcurementInput>) =>
    setEditor((value) => value && { ...value, draft: { ...value.draft, ...patch } });
  const patchLine = (index: number, patch: Partial<ProcurementInput['lines'][number]>) =>
    setEditor(
      (value) =>
        value && {
          ...value,
          draft: {
            ...value.draft,
            lines: value.draft.lines.map((line, position) =>
              position === index ? { ...line, ...patch } : line,
            ),
          },
        },
    );
  async function edit(batchId: string) {
    setBusy(true);
    try {
      const { fingerprint, ...draft } = await apiFetch<ProcurementInput & { fingerprint: string }>(
        `/api/material-pricing-purchases/${batchId}`,
      );
      setEditor({ id: batchId, fingerprint, draft });
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!editor || privacy) return;
    const parsed = procurementSchema.safeParse(editor.draft);
    if (!parsed.success) {
      message.error(t('invalidValues'));
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/material-pricing-purchases${editor.id ? `/${editor.id}` : ''}`, {
        method: editor.id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...parsed.data,
          ...(editor.id ? { fingerprint: editor.fingerprint } : {}),
        }),
      });
      setEditor(undefined);
      changed();
      message.success(common('saved'));
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const columns = [
    { title: t('date'), dataIndex: 'receivedAt', width: 110 },
    { title: t('supplier'), dataIndex: 'distributorName', width: 130 },
    {
      title: t('material'),
      width: 240,
      render: (_: unknown, row: ProcurementRow) => (
        <Link href={`/admin/materials/${row.materialId}`}>
          {row.groupName} · {row.materialName}
        </Link>
      ),
    },
    { title: t('weight'), dataIndex: 'weight' },
    {
      title: t('quote'),
      render: (_: unknown, row: ProcurementRow) => (
        <Sensitive>
          {row.quotePurpose === 'BEFORE_DISCOUNT' ? (row.quote ?? '—') : t('legacyQuote')}
        </Sensitive>
      ),
    },
    {
      title: t('actualPrice'),
      render: (_: unknown, row: ProcurementRow) => <Sensitive>{row.actualPrice ?? '—'}</Sensitive>,
    },
    {
      title: t('discount'),
      render: (_: unknown, row: ProcurementRow) => (
        <Sensitive>
          {row.discount === null ? '—' : t('discountValue', { value: row.discount })}
        </Sensitive>
      ),
    },
    {
      title: t('amount'),
      render: (_: unknown, row: ProcurementRow) => <Sensitive>{row.amount ?? '—'}</Sensitive>,
    },
    {
      title: t('remaining'),
      render: (_: unknown, row: ProcurementRow) =>
        row.remaining === null ? <Tag>{t('unknown')}</Tag> : row.remaining,
    },
    {
      title: t('actions'),
      render: (_: unknown, row: ProcurementRow) => (
        <Button type="link" disabled={privacy || busy} onClick={() => void edit(row.batchId)}>
          {common('edit')}
        </Button>
      ),
    },
  ];
  const summaries = aggregate === 'none' ? [] : summarizeProcurement(rows, aggregate);
  return (
    <div className={ledgerStyles.workspace}>
      {standalone && (
        <div className="page-heading">
          <div>
            <h1>{t('title')}</h1>
            <p className={ledgerStyles.muted}>{t('subtitle')}</p>
          </div>
        </div>
      )}
      {standalone && <MaterialPricingNavigation active="purchases" groupId={group || undefined} />}
      <div className={ledgerStyles.toolbar}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={privacy || !data.materials.length}
          onClick={() =>
            setEditor({
              draft: {
                receivedAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
                distributorId: '',
                initialStock: 'FULL',
                notes: '',
                lines: [
                  {
                    materialId:
                      data.materials.find((item) => !group || item.pricingGroupId === group)?.id ??
                      '',
                    weight: '',
                    quote: null,
                    amount: '',
                    quotePurpose: 'BEFORE_DISCOUNT',
                  },
                ],
              },
            })
          }
        >
          {t('newPurchase')}
        </Button>
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
          {t('import')}
        </Button>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
          {t('refresh')}
        </Button>
        <Link href="/admin/materials">{t('manageMaterials')}</Link>
        <Link href="/admin/distributors">{t('manageSuppliers')}</Link>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {!loading && !data.materials.length && (
        <Alert type="info" showIcon message={t('setupHint')} />
      )}
      {privacy && <Alert type="info" message={t('privacyHint')} />}
      <div className={ledgerStyles.toolbar}>
        <Select
          aria-label={t('group')}
          placeholder={t('group')}
          allowClear
          value={group || undefined}
          options={groups}
          onChange={(value) => changeGroup(value ?? '')}
        />
        <Select
          aria-label={t('supplier')}
          placeholder={t('supplier')}
          allowClear
          showSearch
          optionFilterProp="label"
          value={activeSupplier || undefined}
          options={filterSupplierOptions}
          onChange={(value) => setSupplier(value ?? '')}
        />
        <DateRangeFilter
          kind="received"
          label={t('date')}
          endpointLabels={[t('from'), t('to')]}
          value={dates}
          onChange={setDates}
        />
        <Select
          aria-label={t('view')}
          value={aggregate}
          options={['none', 'month', 'distributor'].map((value) => ({
            value,
            label: t(`view_${value}`),
          }))}
          onChange={setAggregate}
        />
        <Button
          onClick={() => {
            changeGroup('');
            setSupplier('');
            setDates(null);
          }}
        >
          {t('reset')}
        </Button>
      </div>
      <div className={ledgerStyles.table}>
        {aggregate === 'none' ? (
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            scroll={{ x: 1150 }}
            dataSource={rows}
            columns={columns}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          />
        ) : (
          <Table
            size="small"
            rowKey="key"
            loading={loading}
            scroll={{ x: 550 }}
            dataSource={summaries}
            columns={[
              { title: t(aggregate === 'month' ? 'month' : 'supplier'), dataIndex: 'name' },
              { title: t('count'), dataIndex: 'count' },
              {
                title: t('weight'),
                render: (_, row) => `${row.weight}${row.unknownWeight ? ` + ${t('unknown')}` : ''}`,
              },
              {
                title: t('amount'),
                render: (_, row) => (
                  <Sensitive>
                    {row.amount}
                    {row.unknownAmount ? ` + ${t('unknown')}` : ''}
                  </Sensitive>
                ),
              },
            ]}
            expandable={{
              expandedRowRender: (summary) => (
                <Table
                  size="small"
                  rowKey="id"
                  scroll={{ x: 1150 }}
                  dataSource={rows.filter(
                    (row) =>
                      (aggregate === 'month' ? row.receivedAt.slice(0, 7) : row.distributorId) ===
                      summary.key,
                  )}
                  columns={columns}
                  pagination={{ pageSize: 10 }}
                />
              ),
            }}
          />
        )}
      </div>
      <ResponsiveDrawer
        open={!!editor}
        title={editor?.id ? t('editPurchase') : t('newPurchase')}
        width={820}
        destroyOnHidden
        onClose={() => {
          if (!busy) setEditor(undefined);
        }}
        footer={
          <div className={ledgerStyles.toolbar}>
            <Button disabled={busy} onClick={() => setEditor(undefined)}>
              {common('cancel')}
            </Button>
            <Button type="primary" loading={busy} disabled={privacy} onClick={() => void save()}>
              {common('save')}
            </Button>
          </div>
        }
      >
        {editor && (
          <>
            <div className={ledgerStyles.form}>
              <label>
                {t('date')}
                <DateInput
                  aria-label={t('date')}
                  value={editor.draft.receivedAt}
                  onChange={(receivedAt) => patchDraft({ receivedAt })}
                />
              </label>
              <label>
                {t('supplier')}
                <Select
                  showSearch
                  optionFilterProp="label"
                  value={editor.draft.distributorId || undefined}
                  options={supplierOptions}
                  onChange={(value) => patchDraft({ distributorId: value })}
                />
              </label>
              {!editor.id && (
                <label>
                  {t('stockMode')}
                  <Select
                    value={editor.draft.initialStock}
                    options={['FULL', 'UNKNOWN'].map((value) => ({
                      value,
                      label: t(`stock_${value}`),
                    }))}
                    onChange={(value) => patchDraft({ initialStock: value })}
                  />
                </label>
              )}
              <label>
                {t('notes')}
                <Input.TextArea
                  value={editor.draft.notes}
                  onChange={(event) => patchDraft({ notes: event.target.value })}
                />
              </label>
            </div>
            <p className={ledgerStyles.muted}>{t('lineHelp')}</p>
            {editor.draft.lines.map((line, index) => {
              const metrics = procurementMetrics(
                /^\d+(\.\d+)?$/.test(line.weight) ? line.weight : null,
                /^\d+(\.\d+)?$/.test(line.amount) ? line.amount : null,
                line.quote,
              );
              return (
                <div className={ledgerStyles.line} key={line.entryId ?? index}>
                  <label>
                    {t('material')}
                    <Select
                      disabled={!!editor.id}
                      value={line.materialId || undefined}
                      options={materialOptions.filter(
                        (option) =>
                          option.value === line.materialId ||
                          !editor.draft.lines.some((other) => other.materialId === option.value),
                      )}
                      onChange={(value) => patchLine(index, { materialId: value })}
                    />
                  </label>
                  <div className={ledgerStyles.lineFields}>
                    <label>
                      {t('weight')}
                      <InputNumber
                        stringMode
                        min="0.01"
                        precision={2}
                        value={line.weight || null}
                        onChange={(value) => patchLine(index, { weight: value ?? '' })}
                      />
                    </label>
                    <Sensitive>
                      <label>
                        {t('quote')}
                        <InputNumber
                          stringMode
                          min="0"
                          precision={2}
                          value={line.quote}
                          onChange={(value) =>
                            patchLine(index, { quote: value, quotePurpose: 'BEFORE_DISCOUNT' })
                          }
                        />
                      </label>
                      <label>
                        {t('amount')}
                        <InputNumber
                          stringMode
                          min="0"
                          precision={2}
                          value={line.amount || null}
                          onChange={(value) => patchLine(index, { amount: value ?? '' })}
                        />
                      </label>
                      <label>
                        {t('discount')}
                        <InputNumber
                          stringMode
                          min="0"
                          step="0.1"
                          value={metrics.discount}
                          disabled={
                            !line.quote || !line.weight || line.quotePurpose !== 'BEFORE_DISCOUNT'
                          }
                          onChange={(value) => {
                            if (value !== null && line.quote) {
                              const amount = amountFromDiscount(line.weight, line.quote, value);
                              if (amount !== null) patchLine(index, { amount });
                            }
                          }}
                        />
                      </label>
                      <span>
                        {t('actualPrice')}: {metrics.actualPrice ?? '—'}
                      </span>
                    </Sensitive>
                  </div>
                  {!editor.id && editor.draft.lines.length > 1 && (
                    <Button
                      danger
                      onClick={() =>
                        patchDraft({
                          lines: editor.draft.lines.filter((_, position) => index !== position),
                        })
                      }
                    >
                      {t('removeLine')}
                    </Button>
                  )}
                </div>
              );
            })}
            {!editor.id && (
              <Button
                style={{ marginTop: 16 }}
                disabled={editor.draft.lines.length >= Math.min(20, data.materials.length)}
                onClick={() =>
                  patchDraft({
                    lines: [
                      ...editor.draft.lines,
                      {
                        materialId: '',
                        weight: '',
                        amount: '',
                        quote: null,
                        quotePurpose: 'BEFORE_DISCOUNT',
                      },
                    ],
                  })
                }
              >
                {t('addLine')}
              </Button>
            )}
          </>
        )}
      </ResponsiveDrawer>
      <ResponsiveDrawer
        open={importOpen}
        title={t('import')}
        width={1200}
        destroyOnHidden
        onClose={() => {
          if (importDirty)
            modal.confirm({ title: t('leaveTitle'), onOk: () => setImportOpen(false) });
          else setImportOpen(false);
        }}
      >
        <SilverImportWorkspace
          catalog={data}
          onChanged={changed}
          onCatalogRefresh={refresh}
          onDirtyChange={setImportDirty}
          onBackgroundClose={() => setImportOpen(false)}
        />
      </ResponsiveDrawer>
    </div>
  );
}
