'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from 'react';

const PREFIX = 'admin-list:v1:';
const CHANGE_EVENT = 'admin-list-state-change';
const cache = new Map<string, string>();

function parseValue<T>(serialized: string | null, fallback: T): T {
  if (serialized === null) return fallback;
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return fallback;
  }
}

export function useSessionListState<T>(key: string, initialValue: T, restore = true) {
  const storageKey = `${PREFIX}${key}`;
  const [initial] = useState(initialValue);
  const overridePending = useRef(!restore);

  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener(CHANGE_EVENT, notify);
    return () => window.removeEventListener(CHANGE_EVENT, notify);
  }, []);
  const getSnapshot = useCallback(() => {
    if (overridePending.current) return null;
    const cached = cache.get(storageKey);
    if (cached !== undefined) return cached;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved !== null) cache.set(storageKey, saved);
      return saved;
    } catch {
      return null;
    }
  }, [storageKey]);
  const serialized = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const value = useMemo(() => parseValue(serialized, initial), [serialized, initial]);

  const update = useCallback(
    (next: SetStateAction<T>) => {
      const current = parseValue(getSnapshot(), initial);
      const resolved = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      overridePending.current = false;
      const saved = JSON.stringify(resolved);
      if (saved === undefined) {
        cache.delete(storageKey);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          // In-memory state still works when session storage is unavailable.
        }
      } else {
        cache.set(storageKey, saved);
        try {
          sessionStorage.setItem(storageKey, saved);
        } catch {
          // In-memory state still works when session storage is unavailable.
        }
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [getSnapshot, initial, storageKey],
  );

  useEffect(() => {
    if (overridePending.current) update(initial);
  }, [initial, update]);

  return [value, update] as const;
}
