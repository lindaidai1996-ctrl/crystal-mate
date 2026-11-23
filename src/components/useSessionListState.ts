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
import { readListState, subscribeListState, writeListState } from '@/lib/session-list-state';

function parseValue<T>(serialized: string | null, fallback: T): T {
  if (serialized === null) return fallback;
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return fallback;
  }
}

export function useSessionListState<T>(key: string, initialValue: T, restore = true) {
  const [initial] = useState(initialValue);
  const overridePending = useRef(!restore);

  const getSnapshot = useCallback(() => {
    if (overridePending.current) return null;
    return readListState(key);
  }, [key]);
  const serialized = useSyncExternalStore(subscribeListState, getSnapshot, () => null);
  const value = useMemo(() => parseValue(serialized, initial), [serialized, initial]);

  const update = useCallback(
    (next: SetStateAction<T>) => {
      const current = parseValue(getSnapshot(), initial);
      const resolved = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      overridePending.current = false;
      writeListState(key, JSON.stringify(resolved));
    },
    [getSnapshot, initial, key],
  );

  useEffect(() => {
    if (overridePending.current) update(initial);
  }, [initial, update]);

  return [value, update] as const;
}
