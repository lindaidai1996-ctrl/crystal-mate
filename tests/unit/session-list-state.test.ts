import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let state: typeof import('@/lib/session-list-state');
let storage: Map<string, string>;
let browserStorage: Storage;

beforeEach(async () => {
  vi.resetModules();
  storage = new Map();
  browserStorage = {
    get length() {
      return storage.size;
    },
    key: (index) => [...storage.keys()][index] ?? null,
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => void storage.set(key, value),
    removeItem: (key) => void storage.delete(key),
    clear: () => storage.clear(),
  };
  vi.stubGlobal('sessionStorage', browserStorage);
  vi.stubGlobal('window', new EventTarget());
  state = await import('@/lib/session-list-state');
});

afterEach(() => vi.unstubAllGlobals());

describe('list visit state', () => {
  it('restores a filtered list after detail navigation without starting a new menu visit', () => {
    state.writeListState('materials:filters', JSON.stringify({ query: '珍珠', page: 3 }));
    state.writeListState('distributor-detail:one:batches:range', '["2026-11-01","2026-11-19"]');

    expect(JSON.parse(state.readListState('materials:filters')!)).toEqual({
      query: '珍珠',
      page: 3,
    });
    expect(state.readListState('distributor-detail:one:batches:range')).not.toBeNull();
  });

  it('clears cached and unmounted lists, sorts, pagination and detail tabs on menu navigation', () => {
    state.writeListState('materials:filters', '{"query":"珍珠","page":3}');
    state.writeListState('products:cabochons:priceSort', '"ascend"');
    state.writeListState('material-batch-detail:one:tab', '"attachments"');
    // Another list may only exist in storage after a refresh, without an in-memory snapshot.
    storage.set('admin-list:v1:tags:query', '"旧筛选"');
    storage.set('admin-list:v1:tags:pageSize', '50');
    const notify = vi.fn();
    const unsubscribe = state.subscribeListState(notify);

    state.resetListVisit();

    for (const key of [
      'materials:filters',
      'products:cabochons:priceSort',
      'material-batch-detail:one:tab',
      'tags:query',
      'tags:pageSize',
    ]) {
      expect(state.readListState(key)).toBeNull();
      expect(storage.has(`admin-list:v1:${key}`)).toBe(false);
    }
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe();
    state.resetListVisit();
    expect(notify).toHaveBeenCalledOnce();
  });

  it('keeps display preferences and unrelated drafts intact', () => {
    state.writeListState('materials:view:v2', '"table"');
    state.writeListState('products:cabochons:view:v2', '"gallery"');
    state.writeListState('products:finished-strands:density', '"compact"');
    storage.set('material-editor:draft', '{"name":"未保存"}');
    storage.set('privacy-mode', 'true');

    state.resetListVisit();

    expect(state.readListState('materials:view:v2')).toBe('"table"');
    expect(state.readListState('products:cabochons:view:v2')).toBe('"gallery"');
    expect(state.readListState('products:finished-strands:density')).toBe('"compact"');
    expect(storage.get('material-editor:draft')).toBe('{"name":"未保存"}');
    expect(storage.get('privacy-mode')).toBe('true');
  });

  it('resets memory even when session storage is unavailable', () => {
    vi.spyOn(browserStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    state.writeListState('distributors:query', '"供货商"');
    state.writeListState('products:all:density', '"compact"');
    vi.spyOn(browserStorage, 'key').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    vi.spyOn(browserStorage, 'removeItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });

    expect(() => state.resetListVisit()).not.toThrow();
    expect(state.readListState('distributors:query')).toBeNull();
    expect(state.readListState('products:all:density')).toBe('"compact"');
    state.writeListState('distributors:query', '"新查询"');
    expect(state.readListState('distributors:query')).toBe('"新查询"');
  });

  it('does not revive stale filters when removing browser storage fails', () => {
    storage.set('admin-list:v1:tags:query', '"旧筛选"');
    vi.spyOn(browserStorage, 'removeItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });

    state.resetListVisit();

    expect(state.readListState('tags:query')).toBeNull();
    state.writeListState('tags:query', undefined);
    expect(state.readListState('tags:query')).toBeNull();
  });
});
