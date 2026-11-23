const PREFIX = 'admin-list:v1:';
const CHANGE_EVENT = 'admin-list-state-change';
const cache = new Map<string, string | null>();

// Display choices are preferences; filters, sorting, pagination and detail tabs belong to a visit.
const displayPreference =
  /^(materials|products:(all|cabochons|finished-strands)):(view:v2|density)$/;
const storageKey = (key: string) => `${PREFIX}${key}`;

export function subscribeListState(notify: () => void) {
  window.addEventListener(CHANGE_EVENT, notify);
  return () => window.removeEventListener(CHANGE_EVENT, notify);
}

export function readListState(key: string): string | null {
  const fullKey = storageKey(key);
  const cached = cache.get(fullKey);
  if (cached !== undefined) return cached;
  try {
    const saved = sessionStorage.getItem(fullKey);
    cache.set(fullKey, saved);
    return saved;
  } catch {
    return null;
  }
}

export function writeListState(key: string, serialized: string | undefined) {
  const fullKey = storageKey(key);
  cache.set(fullKey, serialized ?? null);
  try {
    if (serialized === undefined) sessionStorage.removeItem(fullKey);
    else sessionStorage.setItem(fullKey, serialized);
  } catch {
    // In-memory state still works when session storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Start a new menu visit. Detail links and their return buttons deliberately do not call this. */
export function resetListVisit() {
  const keys = new Set(cache.keys());
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(PREFIX)) keys.add(key);
    }
  } catch {
    // Also reset cached lists if browser storage is blocked.
  }
  for (const key of keys) {
    if (displayPreference.test(key.slice(PREFIX.length))) continue;
    // A null snapshot prevents a failed storage removal from restoring stale conditions.
    cache.set(key, null);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Keep the in-memory reset effective.
    }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
