'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

const storageKey = 'crystal-mate:privacy-mode';
const changeEvent = 'crystal-mate:privacy-mode-change';
let fallback: boolean | null = null;

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      fallback = null;
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

function getSnapshot() {
  if (fallback !== null) return fallback;
  try {
    return window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

// Keep sensitive values out of the first paint until the browser preference is known.
function getServerSnapshot() {
  return true;
}

export function usePrivacyMode() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setPrivacyMode(enabled: boolean) {
  try {
    window.localStorage.setItem(storageKey, String(enabled));
    fallback = null;
  } catch {
    // The switch still works for this tab when browser storage is unavailable.
    fallback = enabled;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function Sensitive({ children }: { children: ReactNode }) {
  const enabled = usePrivacyMode();
  return enabled ? null : children;
}
