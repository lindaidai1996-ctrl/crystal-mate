'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client-api';
import type { CategoryCounts } from '@/lib/category-counts';

export type CategoryCountState = {
  data?: CategoryCounts;
  loading: boolean;
  error: boolean;
  retry: () => void;
};

export function useCategoryCounts(url: string | null, revision: number): CategoryCountState {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([url, revision, attempt]);
  const [result, setResult] = useState<{
    key: string;
    data?: CategoryCounts;
    error: boolean;
  }>();

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    apiFetch<CategoryCounts>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, error: true });
      });
    return () => controller.abort();
  }, [url, key]);

  const current = result?.key === key ? result : undefined;
  return {
    data: current?.data,
    loading: Boolean(url) && !current,
    error: current?.error ?? false,
    retry: () => setAttempt((value) => value + 1),
  };
}
