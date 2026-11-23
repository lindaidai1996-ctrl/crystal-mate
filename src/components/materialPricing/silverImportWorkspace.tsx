'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
  Select,
  Table,
  Tag,
} from 'antd';
import { Decimal } from '@prisma/client/runtime/index-browser.js';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { Sensitive, usePrivacyMode } from '@/components/privacyMode';
import { ResponsiveModal } from '@/components/responsive/responsiveDialog';
import { DateInput } from '@/components/date-input';
import { useNavigationGuard } from '@/components/navigationGuard';
import type { ProcurementCatalog } from '@/lib/material-pricing/purchase-service';
import { procurementMetrics } from '@/lib/material-pricing/purchase-contracts';
import type { ParsedWorkbook } from '@/lib/cabochonExcelImport/workbook';
import {
  defaultSilverColumns,
  silverKinds,
  type SilverColumnMapping,
  type SilverDraftRow,
  type SilverImport,
  type SilverImportSummary,
  type SilverReviewedRow,
} from '@/lib/material-pricing-import/contracts';
import { normalizeSilverWorkbook, silverRowIssues } from '@/lib/material-pricing-import/normalize';
import ledgerStyles from './procurementLedger.module.css';
import { SilverImportProgressPanel } from './silverImportProgressPanel';

const BASE = '/api/material-pricing-imports';
const cleanRow = (row: SilverDraftRow) => {
  const { receipt: _receipt, ...draft } = row;
  void _receipt;
  return draft;
};
export function SilverImportWorkspace({
  catalog,
  onChanged,
  onCatalogRefresh,
  onDirtyChange,
  onBackgroundClose,
}: {
  catalog: ProcurementCatalog;
  onChanged: () => void;
  onCatalogRefresh: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBackgroundClose?: () => void;
}) {
  const t = useTranslations('silverProcurement'),
    common = useTranslations('common');
  const { message, modal } = App.useApp();
  const privacy = usePrivacyMode(),
    { setGuard } = useNavigationGuard();
  const [file, setFile] = useState<{ name: string; hash: string; workbook: ParsedWorkbook }>();
  const [sheet, setSheet] = useState(''),
    [header, setHeader] = useState(3),
    [mapping, setMapping] = useState<SilverColumnMapping>(defaultSilverColumns);
  const [localRows, setLocalRows] = useState<SilverDraftRow[]>([]),
    [job, setJob] = useState<SilverImport>();
  const [history, setHistory] = useState<SilverImportSummary[]>([]),
    [editing, setEditing] = useState<SilverDraftRow>();
  const [selected, setSelected] = useState<React.Key[]>([]),
    [busy, setBusy] = useState(true),
    [progressError, setProgressError] = useState(''),
    [error, setError] = useState('');
  const [newItem, setNewItem] = useState<{
    type: 'supplier' | 'material';
    name: string;
    area: string;
    categoryId: string;
    groupId: string;
  }>();
  const inFlight = useRef(true);
  const changedRef = useRef(onChanged);
  useEffect(() => {
    changedRef.current = onChanged;
  }, [onChanged]);
  const importing = job?.progress?.status === 'RUNNING';
  const locked = busy || importing;
  const dirty = localRows.length > 0 || editing !== undefined;
  const errorText = useCallback(
    (error: unknown) => {
      const code =
        error instanceof ClientApiError
          ? error.code
          : error instanceof Error
            ? error.message
            : 'SERVER_ERROR';
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
    apiFetch<SilverImportSummary[]>(BASE, { signal: controller.signal })
      .then(async (value) => {
        if (controller.signal.aborted) return;
        setHistory(value);
        const latest =
          value.find((item) => item.progress?.status === 'RUNNING') ??
          value.find((item) => item.progress?.status === 'INTERRUPTED') ??
          value.find((item) => item.progress);
        if (latest) {
          const restored = await apiFetch<SilverImport>(`${BASE}/${latest.id}`, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setJob(restored);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          inFlight.current = false;
        }
      });
    return () => controller.abort();
  }, [errorText]);
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !importing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await apiFetch<SilverImport>(`${BASE}/${jobId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJob(current);
        setHistory((items) =>
          items.map((item) =>
            item.id === current.id
              ? {
                  ...item,
                  committed: current.rows.filter((row) => row.receipt).length,
                  progress: current.progress,
                  updatedAt: current.updatedAt,
                }
              : item,
          ),
        );
        setProgressError('');
        if (current.progress?.status !== 'RUNNING') {
          changedRef.current();
          const history = await apiFetch<SilverImportSummary[]>(BASE, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setHistory(history);
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        setProgressError(t('progressReconnect'));
      }
      timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, importing, t]);
  useEffect(() => {
    onDirtyChange?.(dirty || busy);
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    setGuard((action) => {
      if (!inFlight.current) modal.confirm({ title: t('leaveTitle'), onOk: action });
    });
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      setGuard(null);
    };
  }, [dirty, busy, onDirtyChange, setGuard, modal, t]);
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(errorText(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const rows: SilverReviewedRow[] =
    job?.rows ??
    localRows.map((row) => ({ ...row, issues: silverRowIssues(row), similarBatchIds: [] }));
  const supplierOptions = catalog.distributors.map((item) => ({
    value: item.id,
    label: item.name,
  }));
  const materialOptions = catalog.materials.map((item) => ({
    value: item.id,
    label: `${item.pricingGroup!.name} · ${item.name}`,
  }));
  async function load(id: string) {
    await run(async () => {
      setJob(await apiFetch<SilverImport>(`${BASE}/${id}`));
      setLocalRows([]);
      setFile(undefined);
      setSelected([]);
    });
  }
  function prepare() {
    if (!file || job) return;
    try {
      const parsed = normalizeSilverWorkbook(file.workbook, sheet, header, mapping).map((row) => {
        const suppliers = catalog.distributors.filter((item) => item.name === row.sourceSupplier);
        return {
          ...row,
          distributorId: suppliers.length === 1 ? suppliers[0].id : '',
          lines: row.lines.map((line) => {
            const exactNames =
              line.kind === 'S925'
                ? ['S925', 'S925亮银']
                : line.kind === 'FINE925'
                  ? ['精工925', '精工银']
                  : ['清迈银'];
            const matches = catalog.materials.filter((item) => exactNames.includes(item.name));
            return { ...line, materialId: matches.length === 1 ? matches[0].id : '' };
          }),
        };
      });
      setLocalRows(parsed);
      setSelected([]);
      setError(parsed.length ? '' : t('noRows'));
    } catch (error) {
      setError(errorText(error));
    }
  }
  async function createDraft() {
    if (!file || !localRows.length) return;
    await run(async () => {
      const result = await apiFetch<SilverImport>(BASE, {
        method: 'POST',
        body: JSON.stringify({
          id: crypto.randomUUID(),
          fileHash: file.hash,
          fileName: file.name,
          sheetName: sheet,
          rows: localRows.map(cleanRow),
        }),
      });
      setJob(result);
      setLocalRows([]);
      setSelected([]);
      setHistory(await apiFetch<SilverImportSummary[]>(BASE));
    });
  }
  async function saveRow() {
    if (!editing || privacy) return;
    await run(async () => {
      if (job)
        setJob(
          await apiFetch<SilverImport>(`${BASE}/${job.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ version: job.version, row: cleanRow(editing) }),
          }),
        );
      else
        setLocalRows((rows) =>
          rows.map((row) => (row.rowNumber === editing.rowNumber ? editing : row)),
        );
      setEditing(undefined);
    });
  }
  async function commitSelected() {
    if (!job || privacy) return;
    await run(async () => {
      const numbers = selected
        .map(Number)
        .filter((number) =>
          job.rows.some((row) => row.rowNumber === number && !row.receipt && !row.skipped),
        );
      if (!numbers.length) return;
      setJob(
        await apiFetch<SilverImport>(`${BASE}/${job.id}/run`, {
          method: 'POST',
          body: JSON.stringify({ version: job.version, rowNumbers: numbers }),
        }),
      );
      setSelected([]);
      setHistory(await apiFetch<SilverImportSummary[]>(BASE));
      message.success(t('importStarted'));
    });
  }
  async function resumeImport() {
    if (!job || privacy) return;
    await run(async () => {
      setJob(
        await apiFetch<SilverImport>(`${BASE}/${job.id}/run`, {
          method: 'POST',
          body: JSON.stringify({ version: job.version, resume: true }),
        }),
      );
    });
  }
  const patchEditingLine = (index: number, patch: Partial<SilverDraftRow['lines'][number]>) =>
    setEditing(
      (row) =>
        row && {
          ...row,
          lines: row.lines.map((line, position) =>
            position === index ? { ...line, ...patch } : line,
          ),
        },
    );
  const issueLabel = (row: SilverReviewedRow) =>
    row.receipt ? (
      <Tag color="success">{t('committed')}</Tag>
    ) : row.skipped ? (
      <Tag>{t('skipped')}</Tag>
    ) : row.issues.length ? (
      <span>
        {row.issues.map((issue, index) => (
          <Tag key={index} color="warning">
            {t(`issues.${issue.code}`)}
          </Tag>
        ))}
      </span>
    ) : (
      <Tag color="processing">{t('ready')}</Tag>
    );
  return (
    <div className={ledgerStyles.workspace}>
      <Alert type="info" showIcon message={t('importHelp')} />
      {privacy && <Alert type="info" message={t('privacyHint')} />}
      {error && (
        <Alert
          type="error"
          showIcon
          message={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>}
        />
      )}
      {job?.progress && (
        <SilverImportProgressPanel
          progress={job.progress}
          busy={busy}
          privacy={privacy}
          progressError={progressError}
          errorText={errorText}
          onResume={() => void resumeImport()}
          onBackgroundClose={onBackgroundClose}
        />
      )}
      <div className={ledgerStyles.toolbar}>
        <label>
          <Button
            disabled={busy || dirty}
            onClick={() => document.getElementById('silver-workbook-file')?.click()}
          >
            {t('chooseFile')}
          </Button>
          <input
            id="silver-workbook-file"
            aria-label={t('chooseFile')}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(event) => {
              const input = event.currentTarget,
                chosen = input.files?.[0];
              input.value = '';
              if (!chosen) return;
              void run(async () => {
                if (chosen.size > 20 * 1024 * 1024 || !/\.xlsx$/i.test(chosen.name))
                  throw new Error('EXCEL_FILE_TOO_LARGE');
                const bytes = await chosen.arrayBuffer();
                const { parseWorkbookAsync } = await import('@/lib/cabochonExcelImport/workbook');
                const workbook = await parseWorkbookAsync(new Uint8Array(bytes));
                const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
                  .map((part) => part.toString(16).padStart(2, '0'))
                  .join('');
                const name =
                  workbook.sheets.find((item) => item.name === '总账')?.name ??
                  workbook.sheets[0].name;
                setFile({ name: chosen.name, hash, workbook });
                setSheet(name);
                setHeader(name === '总账' ? 3 : 2);
                setMapping(defaultSilverColumns);
                setJob(undefined);
                setLocalRows([]);
                setSelected([]);
              });
            }}
          />
        </label>
        <Select
          aria-label={t('history')}
          placeholder={t('history')}
          style={{ minWidth: 240 }}
          disabled={busy || dirty}
          value={job?.id}
          options={history.map((item) => ({
            value: item.id,
            label: `${item.fileName} / ${item.sheetName} (${item.committed}/${item.total})${item.progress ? ` · ${t(item.progress.status === 'RUNNING' ? 'importRunning' : item.progress.status === 'INTERRUPTED' ? 'importInterrupted' : 'importFinished')}` : ''}`,
          }))}
          onChange={(id) => void load(id)}
        />
        {job && (
          <Button
            disabled={busy || dirty}
            onClick={() => {
              setJob(undefined);
              setFile(undefined);
              setSelected([]);
            }}
          >
            {t('newImport')}
          </Button>
        )}
        {localRows.length > 0 && (
          <Button
            disabled={busy}
            onClick={() => {
              setLocalRows([]);
              setEditing(undefined);
            }}
          >
            {t('discardPreview')}
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={() =>
            setNewItem({ type: 'supplier', name: '', area: '', categoryId: '', groupId: '' })
          }
        >
          {t('newSupplier')}
        </Button>
        <Button
          disabled={busy || !catalog.groups.length || !catalog.categories.length}
          onClick={() =>
            setNewItem({ type: 'material', name: '', area: '', categoryId: '', groupId: '' })
          }
        >
          {t('newMaterial')}
        </Button>
        <Button disabled={busy} onClick={onCatalogRefresh}>
          {t('refreshCatalog')}
        </Button>
      </div>
      {file && !job && (
        <>
          <div className={ledgerStyles.toolbar}>
            <span>{file.name}</span>
            <Select
              aria-label={t('sheet')}
              value={sheet}
              options={file.workbook.sheets.map((item) => ({ value: item.name, label: item.name }))}
              onChange={(value) => {
                setSheet(value);
                setHeader(value === '总账' ? 3 : 2);
                setLocalRows([]);
              }}
            />
            <label>
              {t('headerRow')}{' '}
              <InputNumber
                min={1}
                max={100}
                value={header}
                onChange={(value) => {
                  setHeader(value ?? 1);
                  setLocalRows([]);
                }}
              />
            </label>
            <Button onClick={prepare}>{t('prepare')}</Button>
          </div>
          <Collapse
            items={[
              {
                key: 'mapping',
                label: t('columnMapping'),
                children: (
                  <div className={ledgerStyles.mapping}>
                    {(['date', 'supplier', 'orderAmount'] as const).map((key) => (
                      <label key={key}>
                        {t(key)}
                        <Input
                          value={mapping[key]}
                          onChange={(event) => {
                            const column = event.target.value
                              .toUpperCase()
                              .replace(/[^A-Z]/g, '')
                              .slice(0, 3);
                            setMapping({ ...mapping, [key]: column });
                            setLocalRows([]);
                          }}
                        />
                      </label>
                    ))}
                    {silverKinds.map((kind) => (
                      <div className={ledgerStyles.line} key={kind}>
                        <strong>{t(`kind_${kind}`)}</strong>
                        {(['weight', 'quote', 'price', 'amount'] as const).map((key) => (
                          <label key={key}>
                            {t(key === 'price' ? 'actualPrice' : key)}
                            <Input
                              value={mapping.lines[kind][key]}
                              onChange={(event) => {
                                setMapping({
                                  ...mapping,
                                  lines: {
                                    ...mapping.lines,
                                    [kind]: {
                                      ...mapping.lines[kind],
                                      [key]: event.target.value
                                        .toUpperCase()
                                        .replace(/[^A-Z]/g, '')
                                        .slice(0, 3),
                                    },
                                  },
                                });
                                setLocalRows([]);
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </>
      )}
      {localRows.length > 0 && (
        <>
          <h3>{t('matchMaterials')}</h3>
          <div className={ledgerStyles.mapping}>
            {silverKinds.map((kind) => (
              <label key={kind}>
                {t(`kind_${kind}`)}
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={materialOptions}
                  value={
                    localRows.flatMap((row) => row.lines).find((line) => line.kind === kind)
                      ?.materialId || undefined
                  }
                  onChange={(value) =>
                    setLocalRows((rows) =>
                      rows.map((row) => ({
                        ...row,
                        lines: row.lines.map((line) =>
                          line.kind === kind ? { ...line, materialId: value ?? '' } : line,
                        ),
                      })),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <h3>{t('matchSuppliers')}</h3>
          <div className={ledgerStyles.mapping}>
            {[...new Set(localRows.map((row) => row.sourceSupplier))].map((name) => (
              <label key={name}>
                {name || t('unknown')}
                <Select
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  options={supplierOptions}
                  value={
                    localRows.find((row) => row.sourceSupplier === name)?.distributorId || undefined
                  }
                  onChange={(value) =>
                    setLocalRows((rows) =>
                      rows.map((row) =>
                        row.sourceSupplier === name ? { ...row, distributorId: value ?? '' } : row,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <Button type="primary" loading={busy} onClick={() => void createDraft()}>
            {t('saveDraft')}
          </Button>
        </>
      )}
      {!!rows.length && (
        <>
          <div className={ledgerStyles.metrics}>
            <span>{t('rowCount', { count: rows.length })}</span>
            <span>
              {t('readyCount', {
                count: rows.filter((row) => !row.receipt && !row.skipped && !row.issues.length)
                  .length,
              })}
            </span>
            <span>{t('committedCount', { count: rows.filter((row) => row.receipt).length })}</span>
          </div>
          <Sensitive>
            <div className={ledgerStyles.metrics}>
              {silverKinds.map((kind) => {
                const lines = rows
                  .filter((row) => !row.skipped)
                  .flatMap((row) => row.lines)
                  .filter((line) => line.kind === kind);
                const valid = lines.filter(
                  (line) => /^\d+(\.\d+)?$/.test(line.weight) && /^\d+(\.\d+)?$/.test(line.amount),
                );
                return (
                  <span key={kind}>
                    {t(`kind_${kind}`)}:{' '}
                    {valid.reduce((sum, line) => sum.plus(line.weight), new Decimal(0)).toFixed(2)}g
                    / ¥
                    {valid.reduce((sum, line) => sum.plus(line.amount), new Decimal(0)).toFixed(2)}{' '}
                    {valid.length < lines.length ? ` + ${t('unknown')}` : ''}
                  </span>
                );
              })}
            </div>
          </Sensitive>
          {job && (
            <div className={ledgerStyles.toolbar}>
              <Button
                disabled={locked}
                onClick={() =>
                  setSelected(
                    rows
                      .filter((row) => !row.receipt && !row.skipped && !row.issues.length)
                      .map((row) => row.rowNumber),
                  )
                }
              >
                {t('selectReady')}
              </Button>
              <Button
                type="primary"
                disabled={privacy || !selected.length || locked}
                loading={busy}
                onClick={() =>
                  modal.confirm({
                    title: t('confirmImport', { count: selected.length }),
                    content: t('historicalStockHint'),
                    onOk: commitSelected,
                  })
                }
              >
                {t('commitSelected')}
              </Button>
            </div>
          )}
          <div className={ledgerStyles.table}>
            <Table
              size="small"
              rowKey="rowNumber"
              scroll={{ x: 900 }}
              dataSource={rows}
              pagination={{ defaultPageSize: 10, showSizeChanger: true }}
              rowSelection={
                job
                  ? {
                      selectedRowKeys: selected,
                      onChange: setSelected,
                      getCheckboxProps: (row) => ({
                        disabled: locked || !!row.receipt || row.skipped || !!row.issues.length,
                      }),
                    }
                  : undefined
              }
              columns={[
                { title: t('sourceRow'), dataIndex: 'rowNumber', width: 70 },
                { title: t('date'), dataIndex: 'receivedAt' },
                { title: t('sourceSupplier'), dataIndex: 'sourceSupplier' },
                {
                  title: t('supplier'),
                  render: (_, row) =>
                    catalog.distributors.find((item) => item.id === row.distributorId)?.name ?? '—',
                },
                {
                  title: t('material'),
                  render: (_, row) => row.lines.map((line) => t(`kind_${line.kind}`)).join(' / '),
                },
                { title: t('status'), render: (_, row) => issueLabel(row) },
                {
                  title: t('actions'),
                  render: (_, row) => (
                    <Button
                      type="link"
                      disabled={locked || !!row.receipt || privacy}
                      onClick={() => {
                        const { issues: _issues, similarBatchIds: _similar, ...draft } = row;
                        void _issues;
                        void _similar;
                        setEditing(draft);
                      }}
                    >
                      {t('review')}
                    </Button>
                  ),
                },
              ]}
              expandable={{
                expandedRowRender: (row) => (
                  <div className={ledgerStyles.workspace}>
                    <Sensitive>
                      <Table
                        size="small"
                        rowKey="kind"
                        pagination={false}
                        dataSource={row.lines}
                        scroll={{ x: 650 }}
                        columns={[
                          {
                            title: t('material'),
                            render: (_, line) =>
                              `${t(`kind_${line.kind}`)} · ${catalog.materials.find((item) => item.id === line.materialId)?.name ?? '—'}`,
                          },
                          { title: t('weight'), dataIndex: 'weight' },
                          { title: t('quote'), dataIndex: 'quote' },
                          {
                            title: t('actualPrice'),
                            render: (_, line) =>
                              /^\d+(\.\d+)?$/.test(line.weight) && /^\d+(\.\d+)?$/.test(line.amount)
                                ? procurementMetrics(
                                    line.weight,
                                    line.amount,
                                    /^\d+(\.\d+)?$/.test(line.quote ?? '') ? line.quote : null,
                                  ).actualPrice
                                : '—',
                          },
                          { title: t('amount'), dataIndex: 'amount' },
                        ]}
                      />
                    </Sensitive>
                    <Collapse
                      items={[
                        {
                          key: 'source',
                          label: t('originalCells'),
                          children: (
                            <Sensitive>
                              <pre className={ledgerStyles.source}>
                                {JSON.stringify(row.original, null, 2)}
                              </pre>
                            </Sensitive>
                          ),
                        },
                      ]}
                    />
                  </div>
                ),
              }}
            />
          </div>
        </>
      )}
      <ResponsiveModal
        open={!!editing}
        title={t('review')}
        width={800}
        destroyOnHidden
        confirmLoading={busy}
        okButtonProps={{ disabled: privacy }}
        onCancel={() => {
          if (!busy) setEditing(undefined);
        }}
        onOk={() => void saveRow()}
      >
        {editing && (
          <div className={ledgerStyles.workspace}>
            <div className={ledgerStyles.form}>
              <label>
                {t('date')}
                <DateInput
                  aria-label={t('date')}
                  value={editing.receivedAt}
                  onChange={(receivedAt) => setEditing({ ...editing, receivedAt })}
                />
              </label>
              <label>
                {t('supplier')}
                <Select
                  showSearch
                  optionFilterProp="label"
                  value={editing.distributorId || undefined}
                  options={supplierOptions}
                  onChange={(value) => setEditing({ ...editing, distributorId: value })}
                />
              </label>
            </div>
            {editing.lines.map((line, index) => (
              <div className={ledgerStyles.line} key={line.kind}>
                <strong>{t(`kind_${line.kind}`)}</strong>
                <label>
                  {t('material')}
                  <Select
                    value={line.materialId || undefined}
                    options={materialOptions}
                    onChange={(value) => patchEditingLine(index, { materialId: value })}
                  />
                </label>
                <div className={ledgerStyles.lineFields}>
                  <label>
                    {t('weight')}
                    <Input
                      value={line.weight}
                      onChange={(event) => patchEditingLine(index, { weight: event.target.value })}
                    />
                  </label>
                  <Sensitive>
                    <label>
                      {t('quote')}
                      <Input
                        value={line.quote ?? ''}
                        onChange={(event) =>
                          patchEditingLine(index, { quote: event.target.value || null })
                        }
                      />
                    </label>
                    <label>
                      {t('amount')}
                      <Input
                        value={line.amount}
                        onChange={(event) =>
                          patchEditingLine(index, {
                            amount: event.target.value,
                            amountConfirmed: false,
                          })
                        }
                      />
                    </label>
                    <span>
                      {t('sourcePrice')}: {line.sourcePrice || '—'}
                    </span>
                    <span>
                      {t('sourceAmount')}: {line.sourceAmount || '—'}
                    </span>
                    <Checkbox
                      checked={line.amountConfirmed}
                      onChange={(event) =>
                        patchEditingLine(index, { amountConfirmed: event.target.checked })
                      }
                    >
                      {t('confirmAmount')}
                    </Checkbox>
                  </Sensitive>
                </div>
              </div>
            ))}
            <Checkbox
              checked={editing.allowDuplicate}
              onChange={(event) => setEditing({ ...editing, allowDuplicate: event.target.checked })}
            >
              {t('allowDuplicate')}
            </Checkbox>
            <Checkbox
              checked={editing.skipped}
              onChange={(event) => setEditing({ ...editing, skipped: event.target.checked })}
            >
              {t('skipRow')}
            </Checkbox>
          </div>
        )}
      </ResponsiveModal>
      <ResponsiveModal
        open={!!newItem}
        title={t(newItem?.type === 'material' ? 'newMaterial' : 'newSupplier')}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setNewItem(undefined);
        }}
        onOk={() =>
          void run(async () => {
            if (!newItem) return;
            if (newItem.type === 'supplier')
              await apiFetch('/api/distributors', {
                method: 'POST',
                body: JSON.stringify({
                  name: newItem.name,
                  area: newItem.area,
                  address: '',
                  wechat: '',
                  phone: '',
                  notes: '',
                }),
              });
            else
              await apiFetch('/api/material-pricing-purchases/catalog', {
                method: 'POST',
                body: JSON.stringify({
                  name: newItem.name,
                  categoryId: newItem.categoryId,
                  groupId: newItem.groupId,
                }),
              });
            setNewItem(undefined);
            onCatalogRefresh();
            message.success(common('saved'));
          })
        }
      >
        {newItem && (
          <div className={ledgerStyles.form}>
            <label>
              {t('name')}
              <Input
                value={newItem.name}
                onChange={(event) => setNewItem({ ...newItem, name: event.target.value })}
              />
            </label>
            {newItem.type === 'supplier' ? (
              <label>
                {t('area')}
                <Input
                  value={newItem.area}
                  onChange={(event) => setNewItem({ ...newItem, area: event.target.value })}
                />
              </label>
            ) : (
              <>
                <label>
                  {t('group')}
                  <Select
                    value={newItem.groupId || undefined}
                    options={catalog.groups.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(value) => setNewItem({ ...newItem, groupId: value })}
                  />
                </label>
                <label>
                  {t('category')}
                  <Select
                    value={newItem.categoryId || undefined}
                    options={catalog.categories.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    onChange={(value) => setNewItem({ ...newItem, categoryId: value })}
                  />
                </label>
              </>
            )}
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
}
