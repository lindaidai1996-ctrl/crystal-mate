'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { uploadImage } from '@/components/imageUpload/uploadImage';
import { useNavigationGuard } from '@/components/navigationGuard';
import { App } from 'antd';
import type { SettingStyle } from '@/lib/client-types';
import {
  MAX_EXCEL_BYTES,
  MAX_EXCEL_ROWS,
  excelRowInputSchema,
  type ColumnMapping,
  type ExcelImport,
  type ExcelImportSummary,
  type ExcelRowInput,
} from '@/lib/cabochonExcelImport/contracts';
import {
  excelTagSource,
  normalizeExcelRow,
  type MatchItem,
} from '@/lib/cabochonExcelImport/normalize';
import { matchNameTags } from '@/lib/recognize-name-tags-client';
import { applyStyleReview } from '@/lib/cabochonExcelImport/styleReview';
import type { ParsedWorkbook } from '@/lib/cabochonExcelImport/workbook';
import { prepareWorkbookRows, type LocalExcelRow } from './prepareRows';

const BASE = '/api/cabochon-excel-imports';
export function useExcelImport(initialId?: string) {
  const t = useTranslations('cabochonExcel');
  const common = useTranslations('common');
  const { modal } = App.useApp();
  const { setGuard } = useNavigationGuard();
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileHash, setFileHash] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [localRows, setLocalRows] = useState<LocalExcelRow[]>([]);
  const [job, setJob] = useState<ExcelImport | null>(null);
  const [tags, setTags] = useState<MatchItem[]>([]);
  const [styles, setStyles] = useState<SettingStyle[]>([]);
  const [history, setHistory] = useState<ExcelImportSummary[]>([]);
  const [duplicates, setDuplicates] = useState<ExcelImportSummary[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const previews = useRef<string[]>([]);
  const uploads = useRef(new Map<string, { objectKey: string; url: string }>());
  const createId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const dirty = localRows.length > 0 && !job;
  const sheet = workbook?.sheets[sheetIndex];
  const rows = job?.rows ?? localRows;
  const errorText = useCallback(
    (value: unknown) => {
      const code =
        value instanceof ClientApiError
          ? value.code
          : value instanceof Error
            ? value.message
            : 'SERVER_ERROR';
      return t.has(`errors.${code}`)
        ? t(`errors.${code}`)
        : common.has(`errors.${code}`)
          ? common(`errors.${code}`)
          : t('errors.SERVER_ERROR');
    },
    [t, common],
  );
  const accept = useCallback((next: ExcelImport) => {
    setJob(next);
    const url = new URL(window.location.href);
    url.searchParams.set('draft', next.id);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    return next;
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(errorText(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setProgress('');
    }
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<MatchItem[]>('/api/tags'),
      apiFetch<SettingStyle[]>('/api/setting-styles'),
      apiFetch<ExcelImportSummary[]>(BASE),
      initialId ? apiFetch<ExcelImport>(`${BASE}/${initialId}`) : Promise.resolve(null),
    ])
      .then(([tags, styles, history, job]) => {
        if (!active) return;
        setTags(tags);
        setStyles(styles);
        setHistory(history);
        setCatalogReady(true);
        if (job) accept(job);
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [initialId, accept, errorText]);
  useEffect(
    () => () => {
      for (const preview of previews.current) URL.revokeObjectURL(preview);
    },
    [],
  );
  useEffect(() => {
    if (!dirty && !busy) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    setGuard((action) => {
      if (inFlight.current) return;
      modal.confirm({ title: t('leaveTitle'), content: t('leaveHelp'), onOk: action });
    });
    return () => {
      window.removeEventListener('beforeunload', handler);
      setGuard(null);
    };
  }, [dirty, busy, modal, setGuard, t]);

  const loadJob = (id: string) =>
    run(async () => {
      const [latest, latestTags, latestStyles] = await Promise.all([
        apiFetch<ExcelImport>(`${BASE}/${id}`),
        apiFetch<MatchItem[]>('/api/tags'),
        apiFetch<SettingStyle[]>('/api/setting-styles'),
      ]);
      accept(latest);
      setTags(latestTags);
      setStyles(latestStyles);
      setSelected([]);
      setRowErrors({});
    });
  const selectSheet = (index: number) => {
    const next = workbook!.sheets[index];
    setSheetIndex(index);
    setHeaderRow(next.headerRow);
    setMapping(next.mapping);
    setLocalRows([]);
    setDuplicates([]);
    setSelected([]);
    setRowErrors({});
    createId.current = crypto.randomUUID();
  };
  const readFile = (file: File) =>
    run(async () => {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('EXCEL_INVALID_FILE');
      if (file.size > MAX_EXCEL_BYTES) throw new Error('EXCEL_FILE_TOO_LARGE');
      const buffer = await file.arrayBuffer();
      setProgress(t('parsing'));
      const { parseWorkbook } = await import('@/lib/cabochonExcelImport/workbook');
      let parsed: ParsedWorkbook;
      try {
        parsed = parseWorkbook(new Uint8Array(buffer));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('EXCEL_')) throw error;
        throw new Error('EXCEL_INVALID_FILE');
      }
      const hash = await crypto.subtle.digest('SHA-256', buffer);
      for (const preview of previews.current) URL.revokeObjectURL(preview);
      previews.current = [];
      uploads.current.clear();
      createId.current = crypto.randomUUID();
      setFileHash(
        [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join(''),
      );
      setFileName(file.name);
      setWorkbook(parsed);
      setSheetIndex(0);
      setHeaderRow(parsed.sheets[0].headerRow);
      setMapping(parsed.sheets[0].mapping);
      setLocalRows([]);
      setJob(null);
      setDuplicates([]);
      setSelected([]);
      setRowErrors({});
      const url = new URL(window.location.href);
      url.searchParams.delete('draft');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    });
  async function recognizeRows(input: ExcelRowInput[], savedJob: ExcelImport | null) {
    const targets = input.filter(
      (row) =>
        row.tagChoice === 'AUTO' && excelTagSource(row) && !('receipt' in row && row.receipt),
    );
    const names = [...new Set(targets.map(excelTagSource))];
    let currentJob = savedJob;
    for (let offset = 0; offset < names.length; offset += 20) {
      const batch = names.slice(offset, offset + 20);
      setProgress(
        t('tagMatching', { current: Math.min(offset + 20, names.length), total: names.length }),
      );
      const matches = await matchNameTags(batch);
      const bySource = new Map(
        batch.map((source, index) => [source, { ...matches[index], source }]),
      );
      const changed = targets
        .filter((row) => bySource.has(excelTagSource(row)))
        .map((row) => ({
          ...row,
          tagMatch: bySource.get(excelTagSource(row))!,
        }));
      if (currentJob) {
        for (const row of changed) {
          currentJob = accept(
            await apiFetch<ExcelImport>(`${BASE}/${currentJob.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                version: currentJob.version,
                row: excelRowInputSchema.strip().parse(row),
              }),
            }),
          );
        }
      } else {
        setLocalRows((rows) =>
          rows.map((row) => {
            const match = bySource.get(excelTagSource(row));
            return row.tagChoice === 'AUTO' && match ? { ...row, tagMatch: match } : row;
          }),
        );
      }
      setSelected((selected) => [
        ...new Set([
          ...selected,
          ...changed
            .filter((row) => !normalizeExcelRow(row, tags, styles).errors.length)
            .map((row) => row.rowNumber),
        ]),
      ]);
    }
  }
  const prepare = () =>
    run(async () => {
      if (!sheet) return;
      const columns = Object.values(mapping).filter(Boolean);
      if (new Set(columns).size !== columns.length) throw new Error('EXCEL_MAPPING_DUPLICATE');
      const prepared = await prepareWorkbookRows(sheet, headerRow, mapping, (url) =>
        previews.current.push(url),
      );
      if (!prepared.length) throw new Error('EXCEL_EMPTY');
      if (prepared.length > MAX_EXCEL_ROWS) throw new Error('EXCEL_TOO_MANY_ROWS');
      const duplicate = await apiFetch<ExcelImportSummary[]>(
        `${BASE}?${new URLSearchParams({ fileHash, sheetName: sheet.name })}`,
      );
      setDuplicates(duplicate);
      setLocalRows(prepared);
      setRowErrors({});
      setSelected(
        prepared
          .filter((row) => !normalizeExcelRow(row, tags, styles).errors.length)
          .map((row) => row.rowNumber),
      );
      await recognizeRows(prepared, null);
    });
  const saveDraft = () =>
    run(async () => {
      if (!sheet) return;
      const data: ExcelRowInput[] = [];
      let count = 0;
      const total = localRows.reduce((sum, row) => sum + row.localImages.length, 0);
      for (const row of localRows) {
        const imageKeys: string[] = [];
        const imageErrors = row.imageErrors.filter((code) => code !== 'IMAGE_UPLOAD_FAILED');
        for (const image of row.localImages) {
          setProgress(t('uploadProgress', { current: ++count, total }));
          try {
            if (!uploads.current.has(image.id))
              uploads.current.set(image.id, await uploadImage(image.file, 'cabochon'));
            imageKeys.push(uploads.current.get(image.id)!.objectKey);
          } catch {
            imageErrors.push('IMAGE_UPLOAD_FAILED');
            if (!row.ignoreImageErrors) {
              setLocalRows((rows) =>
                rows.map((current) =>
                  current.rowNumber === row.rowNumber ? { ...current, imageErrors } : current,
                ),
              );
              throw new Error('EXCEL_IMAGE_UPLOAD_FAILED');
            }
          }
        }
        data.push(excelRowInputSchema.strip().parse({ ...row, imageKeys, imageErrors }));
      }
      try {
        accept(
          await apiFetch<ExcelImport>(BASE, {
            method: 'POST',
            body: JSON.stringify({
              id: createId.current,
              fileHash,
              fileName,
              sheetName: sheet.name,
              rows: data,
            }),
          }),
        );
      } catch (error) {
        // Replace expired grants on retry while retaining the stable import ID.
        if (error instanceof ClientApiError && error.code === 'INVALID_IMAGE')
          uploads.current.clear();
        throw error;
      }
      setHistory(await apiFetch<ExcelImportSummary[]>(BASE));
    });
  const saveRow = async (row: ExcelRowInput, applySameStyle = false) => {
    if (!job) {
      setLocalRows((rows) => applyStyleReview(rows, row, applySameStyle));
      return true;
    }
    let saved = false;
    await run(async () => {
      accept(
        await apiFetch<ExcelImport>(`${BASE}/${job.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            version: job.version,
            row: excelRowInputSchema.strip().parse(row),
            applySameStyle,
          }),
        }),
      );
      saved = true;
      setRowErrors((errors) => {
        const next = { ...errors };
        for (const current of applyStyleReview(job.rows, row, applySameStyle)) {
          if (current !== job.rows.find((item) => item.rowNumber === current.rowNumber))
            delete next[current.rowNumber];
        }
        return next;
      });
    });
    return saved;
  };
  const commit = () =>
    run(async () => {
      if (!job) return;
      let current = job;
      const targets = current.rows.filter(
        (row) =>
          selected.includes(row.rowNumber) &&
          !row.receipt &&
          !normalizeExcelRow(row, tags, styles).errors.length,
      );
      const failures: Record<number, string> = {};
      for (const [index, row] of targets.entries()) {
        setProgress(t('commitProgress', { current: index + 1, total: targets.length }));
        try {
          current = accept(
            await apiFetch<ExcelImport>(`${BASE}/${current.id}/commit`, {
              method: 'POST',
              body: JSON.stringify({ version: current.version, rowNumber: row.rowNumber }),
            }),
          );
        } catch (error) {
          // Refresh after every failed/lost response; the server may already have committed this row.
          try {
            current = accept(await apiFetch<ExcelImport>(`${BASE}/${current.id}`));
          } catch {
            failures[row.rowNumber] = errorText(error);
            break;
          }
          if (!current.rows.find((item) => item.rowNumber === row.rowNumber)?.receipt)
            failures[row.rowNumber] = errorText(error);
          if (error instanceof ClientApiError && error.code === 'EXCEL_CONFLICT') break;
        }
        setRowErrors({ ...failures });
      }
      setRowErrors(failures);
      setSelected(Object.keys(failures).map(Number));
      const [latestHistory, latestStyles] = await Promise.all([
        apiFetch<ExcelImportSummary[]>(BASE),
        apiFetch<SettingStyle[]>('/api/setting-styles'),
      ]);
      setHistory(latestHistory);
      setStyles(latestStyles);
    });
  return {
    workbook,
    fileName,
    sheetIndex,
    sheet,
    headerRow,
    mapping,
    localRows,
    job,
    rows,
    tags,
    styles,
    history,
    duplicates,
    selected,
    busy,
    progress,
    error,
    rowErrors,
    catalogReady,
    setSelected,
    setHeaderRow,
    setMapping,
    selectSheet,
    readFile,
    prepare,
    saveDraft,
    saveRow,
    commit,
    matchTags: () => run(() => recognizeRows(rows, job)),
    loadJob,
    addTag: (tag: MatchItem) => setTags((tags) => [...tags, tag]),
    clearPreview: () => {
      setLocalRows([]);
      setSelected([]);
    },
  };
}
