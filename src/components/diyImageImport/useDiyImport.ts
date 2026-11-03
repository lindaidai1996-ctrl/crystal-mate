'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { uploadImage } from '@/components/imageUpload/uploadImage';
import { MAX_UPLOAD_BYTES, validateImageSource } from '@/components/imageUpload/prepareImages';
import type { ImportModelOption } from '@/lib/materialImageImport/contracts';
import {
  diySaveSchema,
  MAX_DIY_IMAGES,
  type DiyHistoryItem,
  type DiyImage,
  type DiyImport,
} from '@/lib/diyImageImport/contracts';

const BASE = '/api/diy-image-imports';
export function useDiyImport(initialId?: string) {
  const t = useTranslations('diyImport');
  const common = useTranslations('common');
  const [job, setJob] = useState<DiyImport | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ImportModelOption[]>([]);
  const [history, setHistory] = useState<DiyHistoryItem[]>([]);
  const inFlight = useRef(false);
  const editRevision = useRef(0);
  const [autoSaveBlocked, setAutoSaveBlocked] = useState(false);

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
          : t('errors.SERVER_ERROR');
    },
    [common, t],
  );
  const refreshHistory = useCallback(async () => {
    const result = await apiFetch<{ models: ImportModelOption[]; items: DiyHistoryItem[] }>(BASE);
    setModels(result.models);
    setHistory(result.items);
  }, []);
  const accept = useCallback((next: DiyImport) => {
    setJob(next);
    setDirty(false);
    setAutoSaveBlocked(false);
    setHistory((items) =>
      items.map((item) =>
        item.id === next.id ? { ...item, name: next.data.name, status: next.status } : item,
      ),
    );
    const url = new URL(window.location.href);
    url.searchParams.set('draft', next.id);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    return next;
  }, []);
  const run = useCallback(
    async (action: () => Promise<void>) => {
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
      }
    },
    [errorText],
  );
  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<{ models: ImportModelOption[]; items: DiyHistoryItem[] }>(BASE),
      initialId ? apiFetch<DiyImport>(`${BASE}/${initialId}`) : Promise.resolve(null),
    ])
      .then(([result, draft]) => {
        if (!active) return;
        setModels(result.models);
        setHistory(result.items);
        if (draft) accept(draft);
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialId, accept, errorText]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const save = useCallback(async () => {
    if (!job) throw new Error('NOT_FOUND');
    const input = diySaveSchema.parse({ version: job.version, images: job.images, data: job.data });
    const revision = editRevision.current;
    const next = await apiFetch<DiyImport>(`${BASE}/${job.id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    if (revision === editRevision.current) return accept(next);
    // A delayed catalog selection can finish during autosave. Keep that newer edit,
    // but advance its version so the next save does not conflict with our own write.
    setJob((current) =>
      current?.id === next.id ? { ...next, data: current.data, images: current.images } : current,
    );
    setDirty(true);
    return next;
  }, [job, accept]);
  // Persist edits shortly after typing, so a reopened draft keeps human review work.
  useEffect(() => {
    if (!dirty || busy || autoSaveBlocked || !job || job.status === 'COMMITTED') return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      save()
        .catch((error) => {
          setAutoSaveBlocked(true);
          setError(errorText(error));
        })
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    }, 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [dirty, busy, job, save, errorText, autoSaveBlocked]);

  const processing = job?.status === 'PROCESSING';
  useEffect(() => {
    if (!processing || !job || busy || dirty) return;
    let active = true;
    const timer = setInterval(() => {
      apiFetch<DiyImport>(`${BASE}/${job.id}`)
        .then((next) => {
          if (active) accept(next);
        })
        .catch((error) => {
          if (active) setError(errorText(error));
        });
    }, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [processing, job, busy, dirty, accept, errorText]);

  function edit(transform: (job: DiyImport) => DiyImport) {
    if (!job || busy || job.status === 'COMMITTED') return;
    editRevision.current += 1;
    setJob((current) => (current ? transform(current) : current));
    setDirty(true);
    setAutoSaveBlocked(false);
    setError(null);
  }
  async function uploaded(files: File[]): Promise<DiyImage[]> {
    const images: DiyImage[] = [];
    for (const file of files) {
      if (validateImageSource(file) || file.size > MAX_UPLOAD_BYTES)
        throw new Error('DIY_IMAGE_TOO_LARGE');
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      const image = await uploadImage(file, 'import-source');
      images.push({
        id: crypto.randomUUID(),
        objectKey: image.objectKey,
        url: image.url,
        fileName: file.name,
        width,
        height,
      });
    }
    return images;
  }
  async function addImages(files: File[], targetProductId?: string) {
    await run(async () => {
      if (!files.length || files.length + (job?.images.length ?? 0) > MAX_DIY_IMAGES)
        throw new Error('DIY_IMAGE_LIMIT');
      const images = await uploaded(files);
      if (job) {
        const current = dirty ? await save() : job;
        accept(
          await apiFetch<DiyImport>(`${BASE}/${current.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              version: current.version,
              images: [...current.images, ...images],
              data: current.data,
            }),
          }),
        );
      } else {
        accept(
          await apiFetch<DiyImport>(BASE, {
            method: 'POST',
            body: JSON.stringify({
              id: crypto.randomUUID(),
              images,
              targetProductId: targetProductId ?? null,
            }),
          }),
        );
      }
      await refreshHistory();
    });
  }
  function recognize(provider: string, partId?: string) {
    return run(async () => {
      if (!job) return;
      const current = dirty ? await save() : job;
      setJob({
        ...current,
        status: 'PROCESSING',
        errorCode: null,
        leaseUntil: new Date(Date.now() + 4 * 60_000).toISOString(),
      });
      try {
        accept(
          await apiFetch<DiyImport>(`${BASE}/${current.id}/recognize`, {
            method: 'POST',
            body: JSON.stringify({ version: current.version, provider, partId }),
          }),
        );
      } catch (error) {
        // Recover the incremented lease/version without discarding the draft on model failure.
        accept(await apiFetch<DiyImport>(`${BASE}/${current.id}`));
        throw error;
      }
    });
  }
  function commit() {
    return run(async () => {
      if (!job) return;
      const current = dirty ? await save() : job;
      accept(
        await apiFetch<DiyImport>(`${BASE}/${current.id}/commit`, {
          method: 'POST',
          body: JSON.stringify({ version: current.version }),
        }),
      );
      await refreshHistory();
    });
  }
  function load(id: string, discardUnsaved = false) {
    return run(async () => {
      if (dirty && !discardUnsaved) await save();
      accept(await apiFetch<DiyImport>(`${BASE}/${id}`));
    });
  }
  function reset() {
    return run(async () => {
      if (dirty) await save();
      setJob(null);
      setDirty(false);
      const url = new URL(window.location.href);
      url.searchParams.delete('draft');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    });
  }
  function remove() {
    return run(async () => {
      if (!job) return;
      const current = dirty ? await save() : job;
      await apiFetch(`${BASE}/${job.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: current.version }),
      });
      setJob(null);
      setDirty(false);
      await refreshHistory();
      const url = new URL(window.location.href);
      url.searchParams.delete('draft');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    });
  }
  return {
    job,
    dirty,
    busy,
    loading,
    error,
    models,
    history,
    run,
    edit,
    save,
    addImages,
    recognize,
    commit,
    load,
    reset,
    remove,
    errorText,
  };
}
