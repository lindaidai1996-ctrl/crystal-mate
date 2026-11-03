'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { App } from 'antd';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { uploadImage } from '@/components/imageUpload/uploadImage';
import { cropImage } from '@/components/imageUpload/cropImage';
import {
  MAX_UPLOAD_BYTES,
  prepareImage,
  validateImageSource,
} from '@/components/imageUpload/prepareImages';
import { patchImportItem } from '@/lib/materialImageImport/materialDraft';
import { validateImageImport } from '@/lib/materialImageImport/importValidation';
import { ImportDraftSession } from '@/lib/materialImageImport/draftSession';
import type {
  ImageImport,
  ImportItemData,
  ImportModelOption,
  ImportBox,
  ImportRecognitionPreview,
} from '@/lib/materialImageImport/contracts';

export type ImportHistoryItem = {
  id: string;
  fileName: string;
  status: string;
  _count: { items: number };
};

export function useImageImport() {
  const t = useTranslations('imageImport');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [session] = useState(() => new ImportDraftSession());
  const draft = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { job, dirty } = draft;
  const operation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [models, setModels] = useState<ImportModelOption[]>([]);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [validationJobId, setValidationJobId] = useState<string | null>(null);
  const validation = useMemo(
    () => (job && validationJobId === job.id ? validateImageImport(job) : null),
    [job, validationJobId],
  );
  const lastId = useCallback(() => session.lastId(), [session]);

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
    [common, t],
  );

  const refreshHistory = useCallback(async () => {
    const result = await apiFetch<{ items: ImportHistoryItem[]; models: ImportModelOption[] }>(
      '/api/material-image-imports',
    );
    setHistory(result.items);
    setModels(result.models);
  }, []);

  const accept = useCallback(
    (next: ImageImport) => {
      session.accept(next);
      const url = new URL(window.location.href);
      url.searchParams.set('import', next.id);
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      return next;
    },
    [session],
  );

  const load = useCallback(
    async (id: string) => {
      if (operation.current) return;
      operation.current = true;
      setBusy(true);
      setError(null);
      setValidationJobId(null);
      try {
        const next = await apiFetch<ImageImport>(`/api/material-image-imports/${id}`);
        session.open(next);
        const url = new URL(window.location.href);
        url.searchParams.set('import', next.id);
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
      } catch (error) {
        setError(errorText(error));
      } finally {
        operation.current = false;
        setBusy(false);
      }
    },
    [session, errorText],
  );

  useEffect(() => {
    apiFetch<{ items: ImportHistoryItem[]; models: ImportModelOption[] }>(
      '/api/material-image-imports',
    )
      .then((result) => {
        setHistory(result.items);
        setModels(result.models);
      })
      .catch((error) => setError(errorText(error)));
  }, [errorText]);

  useEffect(() => {
    if (!dirty && !draft.recovery) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, draft.recovery]);

  const processingId = job?.status === 'PROCESSING' ? job.id : null;
  useEffect(() => {
    if (!processingId || dirty || busy || draft.recovery) return;
    const id = processingId;
    let cancelled = false;
    const timer = setInterval(() => {
      apiFetch<ImageImport>(`/api/material-image-imports/${id}`)
        .then((next) => {
          const current = session.getSnapshot();
          if (
            !cancelled &&
            !operation.current &&
            !current.dirty &&
            !current.recovery &&
            current.job?.id === id
          )
            session.accept(next);
        })
        .catch((error) => {
          if (!cancelled) setError(errorText(error));
        });
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [processingId, dirty, busy, draft.recovery, errorText, session]);

  function edit(transform: (job: ImageImport) => ImageImport) {
    if (!operation.current) {
      session.edit(transform);
      setError(null);
    }
  }

  function patchItem(id: string, patch: Partial<ImportItemData>) {
    edit((current) => ({
      ...current,
      items: current.items.map((row) =>
        row.id === id && !row.entryId ? { ...row, data: patchImportItem(row.data, patch) } : row,
      ),
    }));
  }

  async function saveRemote(current: ImageImport) {
    try {
      return await apiFetch<ImageImport>(`/api/material-image-imports/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: current.version,
          settings: current.settings,
          items: current.items.map(({ id, data }) => ({ id, data })),
        }),
      });
    } catch (error) {
      if (error instanceof ClientApiError && error.code === 'IMPORT_CONFLICT') {
        try {
          session.offerRecovery(
            await apiFetch<ImageImport>(`/api/material-image-imports/${current.id}`),
          );
        } catch {
          // Keep the current edits and backup when even the conflict check is offline.
        }
      }
      throw error;
    }
  }

  async function save() {
    return session.save(saveRemote);
  }

  async function run(action: () => Promise<void>) {
    if (operation.current || session.getSnapshot().recovery) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(errorText(error));
    } finally {
      operation.current = false;
      setBusy(false);
      setProgress('');
    }
  }

  async function create(file: File, provider: string, priceKind: 'PURCHASE' | 'SALE') {
    await run(async () => {
      const invalid = validateImageSource(file);
      if (invalid)
        throw new Error(invalid === 'tooLarge' ? 'IMPORT_IMAGE_TOO_LARGE' : 'INVALID_IMAGE');
      setProgress(t('uploading'));
      const prepared = file.size > MAX_UPLOAD_BYTES ? await prepareImage(file) : null;
      const source = prepared ? prepared.compressed : file;
      if (!source) throw new Error('IMPORT_IMAGE_TOO_LARGE');
      const bitmap = await createImageBitmap(source);
      const { width, height } = bitmap;
      bitmap.close();
      if (width > 8192 || height > 8192) throw new Error('IMPORT_IMAGE_DIMENSIONS');
      setProgress(t('uploading'));
      const image = await uploadImage(source, 'import-source');
      const created = accept(
        await apiFetch<ImageImport>('/api/material-image-imports', {
          method: 'POST',
          body: JSON.stringify({
            sourceKey: image.objectKey,
            fileName: file.name.slice(0, 200),
            width,
            height,
            provider,
            priceKind,
          }),
        }),
      );
      await requestRecognition(created, provider);
    });
  }

  async function remove() {
    if (!job) return;
    await run(async () => {
      await apiFetch<void>(`/api/material-image-imports/${job.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: job.version }),
      });
      session.clear();
      setHistory((items) => items.filter((item) => item.id !== job.id));
      const url = new URL(window.location.href);
      url.searchParams.delete('import');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      message.success(
        t(job.items.some((item) => item.entryId) ? 'recordArchived' : 'recordDeleted'),
      );
      await refreshHistory();
    });
  }

  async function requestRecognition(current: ImageImport, provider: string) {
    setValidationJobId(null);
    setProgress(t('recognizing'));
    try {
      accept(
        await apiFetch<ImageImport>(`/api/material-image-imports/${current.id}/recognize`, {
          method: 'POST',
          body: JSON.stringify({ version: current.version, provider }),
        }),
      );
    } catch (error) {
      accept(await apiFetch<ImageImport>(`/api/material-image-imports/${current.id}`));
      throw error;
    }
    await refreshHistory();
  }

  async function recognize(provider: string) {
    if (!job) return;
    await run(async () => {
      const current = dirty ? await save() : job;
      await requestRecognition(current, provider);
    });
  }

  async function recognizeItem(
    itemId: string,
    provider: string,
    boxes: { objectBox: ImportBox; priceBox: ImportBox | null },
  ) {
    if (!job) throw new Error('NOT_FOUND');
    if (operation.current || session.getSnapshot().recovery) throw new Error('IMPORT_CONFLICT');
    operation.current = true;
    setBusy(true);
    setError(null);
    setProgress(t('recognizingItem'));
    try {
      const current = dirty ? await save() : job;
      return await apiFetch<ImportRecognitionPreview>(
        `/api/material-image-imports/${current.id}/recognize-item`,
        {
          method: 'POST',
          body: JSON.stringify({ version: current.version, itemId, provider, ...boxes }),
        },
      );
    } finally {
      operation.current = false;
      setBusy(false);
      setProgress('');
    }
  }

  async function commit() {
    await run(async () => {
      const latest = session.getSnapshot().job;
      if (!latest) return;
      const selected = latest.items.filter((item) => item.data.selected && !item.entryId);
      if (!selected.length) return;
      setValidationJobId(latest.id);
      const problems = validateImageImport(latest);
      if (problems.settings.length || problems.items.length) {
        if (problems.items[0]) session.select(problems.items[0].id);
        return;
      }
      let current = await save();
      const response = await fetch(current.sourceUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('INVALID_IMAGE');
      const blob = await response.blob();
      const source = new File([blob], 'source', { type: blob.type });
      const bitmap = await createImageBitmap(source);
      const { width, height } = bitmap;
      bitmap.close();
      for (let index = 0; index < selected.length; index++) {
        const item = selected[index];
        setProgress(t('importProgress', { current: index + 1, total: selected.length }));
        const box = item.data.objectBox;
        const x = Math.floor((box.x * width) / 1000);
        const y = Math.floor((box.y * height) / 1000);
        const crop = await cropImage(
          source,
          {
            x,
            y,
            width: Math.min(width - x, Math.ceil((box.width * width) / 1000)),
            height: Math.min(height - y, Math.ceil((box.height * height) / 1000)),
          },
          0,
        );
        const prepared =
          crop.size > MAX_UPLOAD_BYTES ? await prepareImage(crop, { cropped: true }) : null;
        const image = await uploadImage(prepared?.compressed ?? crop, 'import-crop');
        try {
          current = accept(
            await apiFetch<ImageImport>(`/api/material-image-imports/${current.id}/commit`, {
              method: 'POST',
              body: JSON.stringify({
                version: current.version,
                itemId: item.id,
                imageKey: image.objectKey,
              }),
            }),
          );
        } catch (error) {
          accept(await apiFetch<ImageImport>(`/api/material-image-imports/${current.id}`));
          session.select(item.id);
          setError(
            t('itemImportFailed', {
              number: latest.items.findIndex((row) => row.id === item.id) + 1,
              name: item.data.material?.values.name || item.data.name || t('unnamed'),
              error: errorText(error),
            }),
          );
          return;
        }
      }
      message.success(t('importSuccess', { count: selected.length }));
      await refreshHistory();
    });
  }

  return {
    ...draft,
    job,
    dirty,
    busy,
    progress,
    models,
    history,
    error,
    validation,
    errorText,
    lastId,
    select: (id: string) => session.select(id),
    continueReview: () => {
      const current = session.getSnapshot();
      if (!current.job) return;
      const next = current.job.items.find(
        (item) => !item.entryId && item.data.selected && !item.data.reviewed,
      );
      if (next) session.select(next.id);
    },
    canRecoverLocal: session.canRecoverLocal(),
    resolveRecovery: (choice: 'local' | 'server') => {
      session.resolveRecovery(choice);
      setError(null);
    },
    confirm: (id: string) =>
      run(async () => {
        await session.confirm(id, saveRemote);
      }),
    load,
    edit,
    patchItem,
    create,
    remove,
    recognize,
    recognizeItem,
    commit,
    save: () =>
      run(async () => {
        await save();
        message.success(t('saved'));
      }),
  };
}
