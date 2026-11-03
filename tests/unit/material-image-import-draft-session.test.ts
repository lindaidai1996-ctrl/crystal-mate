import { describe, expect, it, vi } from 'vitest';
import { ImportDraftSession } from '@/lib/materialImageImport/draftSession';
import { newImportItem, type ImageImport } from '@/lib/materialImageImport/contracts';
import { importMaterialDraft } from '@/lib/materialImageImport/materialDraft';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const third = '33333333-3333-4333-8333-333333333333';

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

function job(): ImageImport {
  return {
    id: 'import-1',
    sourceUrl: '/source.png',
    fileName: '供应商.jpg',
    width: 800,
    height: 600,
    provider: 'deepseek',
    model: 'vision',
    status: 'READY',
    version: 3,
    updatedAt: '2026-10-22T01:00:00.000Z',
    settings: { distributorId: '', selection: null, priceKind: 'PURCHASE' },
    warnings: [],
    errorCode: null,
    leaseUntil: null,
    items: [first, second, third].map((id) => ({
      id,
      data: newImportItem('PURCHASE'),
      materialId: null,
      entryId: null,
    })),
  };
}

function rename(session: ImportDraftSession, name: string) {
  session.edit((current) => ({
    ...current,
    items: current.items.map((item, index) =>
      index === 0 ? { ...item, data: { ...item.data, name } } : item,
    ),
  }));
}

describe('material image import draft persistence', () => {
  it('retains unfinished numeric input and all other edits even when server validation would fail', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    const material = importMaterialDraft(job().items[0].data);
    material.values.purchaseUnitPrice = '12.';
    material.values.notes = '尚未完成的输入也要保留';
    session.edit((current) => ({
      ...current,
      items: current.items.map((item, index) =>
        index === 0 ? { ...item, data: { ...item.data, material, quantity: 0 } } : item,
      ),
    }));
    const refreshed = new ImportDraftSession(() => storage);
    refreshed.open(job());
    expect(refreshed.getSnapshot()).toMatchObject({ dirty: true, restored: true });
    expect(refreshed.getSnapshot().job?.items[0].data).toMatchObject({
      quantity: 0,
      material: { values: { purchaseUnitPrice: '12.', notes: '尚未完成的输入也要保留' } },
    });
  });

  it('backs up edits without a server save and restores the complete incomplete form and review position on refresh', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    const server = job();
    session.open(server);
    const material = importMaterialDraft(server.items[0].data);
    material.values.notes = '校验备注';
    material.values.purchaseUnitPrice = '12.50';
    session.edit((current) => ({
      ...current,
      items: current.items.map((item, index) =>
        index === 0 ? { ...item, data: { ...item.data, reviewed: true, material } } : item,
      ),
    }));
    session.select(second);

    const refreshed = new ImportDraftSession(() => storage);
    expect(refreshed.lastId()).toBe(server.id);
    refreshed.open(server);
    expect(refreshed.getSnapshot()).toMatchObject({
      dirty: true,
      restored: true,
      activeId: second,
      recovery: null,
    });
    expect(refreshed.getSnapshot().job?.items[0].data).toMatchObject({
      reviewed: true,
      material: { values: { notes: '校验备注', purchaseUnitPrice: '12.50' } },
    });
  });

  it('saves the latest edits and reviewed flag, and advances only after acknowledgement', async () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '刚刚修改的物料');
    let resolve!: (saved: ImageImport) => void;
    const remote = vi.fn(
      () =>
        new Promise<ImageImport>((done) => {
          resolve = done;
        }),
    );
    const pending = session.confirm(first, remote);
    expect(remote).toHaveBeenCalledOnce();
    expect(remote.mock.calls[0]).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ activeId: first, saving: true, dirty: true });
    const sent = session.getSnapshot().job!;
    expect(sent.items[0].data).toMatchObject({ name: '刚刚修改的物料', reviewed: true });
    // A duplicate click or edit while the save is in flight cannot start another request.
    await session.confirm(first, remote);
    rename(session, '不应覆盖保存结果');
    expect(remote).toHaveBeenCalledOnce();
    resolve({ ...sent, version: 4, updatedAt: '2026-10-22T02:00:00.000Z' });
    await pending;
    expect(session.getSnapshot()).toMatchObject({
      activeId: second,
      saving: false,
      dirty: false,
      savedAt: '2026-10-22T02:00:00.000Z',
    });
    expect(session.getSnapshot().job?.items[0].data.name).toBe('刚刚修改的物料');
    const refreshed = new ImportDraftSession(() => storage);
    refreshed.open(session.getSnapshot().job!);
    expect(refreshed.getSnapshot()).toMatchObject({ activeId: second, dirty: false });
  });

  it('retains the edited content and position on save failure and supports retry', async () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    const server = job();
    session.open(server);
    rename(session, '断网前校验的名称');
    await expect(
      session.confirm(first, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(session.getSnapshot()).toMatchObject({
      saveFailed: true,
      dirty: true,
      activeId: first,
      saving: false,
    });
    const refreshed = new ImportDraftSession(() => storage);
    refreshed.open(server);
    expect(refreshed.getSnapshot().job?.items[0].data).toMatchObject({
      name: '断网前校验的名称',
      reviewed: true,
    });
    await session.confirm(first, async (current) => ({ ...current, version: current.version + 1 }));
    expect(session.getSnapshot()).toMatchObject({
      saveFailed: false,
      dirty: false,
      activeId: second,
    });
  });

  it('saves the last pending item without switching to an imported, excluded or reviewed item', async () => {
    const session = new ImportDraftSession(() => memoryStorage());
    const server = job();
    server.items[1].data.selected = false;
    server.items[2].entryId = 'entry-3';
    session.open(server);
    await session.confirm(first, async (current) => ({ ...current, version: 4 }));
    expect(session.getSnapshot()).toMatchObject({ dirty: false, activeId: first });
  });

  it('does not silently overwrite either version when the server changed, even after another refresh', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '本地校对名称');
    const server = job();
    server.version++;
    server.items[0].data.name = '其他窗口的名称';
    const refreshed = new ImportDraftSession(() => storage);
    refreshed.open(server);
    expect(refreshed.getSnapshot().job?.items[0].data.name).toBe('其他窗口的名称');
    expect(refreshed.getSnapshot().recovery?.draft.items[0].data.name).toBe('本地校对名称');
    rename(refreshed, '冲突解决前不能编辑');
    const again = new ImportDraftSession(() => storage);
    again.open(server);
    expect(again.getSnapshot().recovery?.draft.items[0].data.name).toBe('本地校对名称');
    again.resolveRecovery('local');
    expect(again.getSnapshot()).toMatchObject({ dirty: true, restored: true, recovery: null });
    expect(again.getSnapshot().job).toMatchObject({
      version: 4,
      items: [{ data: { name: '本地校对名称' } }, {}, {}],
    });
  });

  it('uses the server version only after an explicit choice and clears stale local edits', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '本地修改');
    const server = { ...job(), version: 4 };
    session.open(server);
    session.resolveRecovery('server');
    const refreshed = new ImportDraftSession(() => storage);
    refreshed.open(server);
    expect(refreshed.getSnapshot()).toMatchObject({
      recovery: null,
      dirty: false,
      restored: false,
    });
    expect(refreshed.getSnapshot().job?.items[0].data.name).toBe('');
  });

  it('preserves server stock records and locked settings when explicitly restoring local candidates', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '过期本地物料');
    const server = job();
    server.version++;
    server.items[0] = {
      ...server.items[0],
      entryId: 'entry-1',
      materialId: 'material-1',
      data: { ...server.items[0].data, name: '已入库物料', reviewed: true },
    };
    server.settings.distributorId = 'server-supplier';
    session.open(server);
    session.resolveRecovery('local');
    expect(session.getSnapshot().job?.items[0]).toEqual(server.items[0]);
    expect(session.getSnapshot().job?.settings).toEqual(server.settings);
    expect(session.getSnapshot().job?.items).toHaveLength(3);
  });

  it('recognizes a save that reached the server before the response was lost', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '已保存但未收到响应');
    const server = { ...session.getSnapshot().job!, version: 4 };
    const refreshed = new ImportDraftSession(() => storage);
    refreshed.open(server);
    expect(refreshed.getSnapshot()).toMatchObject({
      dirty: false,
      recovery: null,
      restored: false,
    });
    expect(refreshed.getSnapshot().job?.items[0].data.name).toBe('已保存但未收到响应');
  });

  it('offers a choice for a conflict discovered during save without replacing the backup', async () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '我的修改');
    const server = { ...job(), version: 4 };
    await expect(
      session.confirm(first, async () => {
        session.offerRecovery(server);
        throw new Error('IMPORT_CONFLICT');
      }),
    ).rejects.toThrow('IMPORT_CONFLICT');
    expect(session.getSnapshot().recovery?.draft.items[0].data).toMatchObject({
      name: '我的修改',
      reviewed: true,
    });
    const refreshed = new ImportDraftSession(() => storage);
    refreshed.open(server);
    expect(refreshed.getSnapshot().recovery?.draft.items[0].data.name).toBe('我的修改');
  });

  it('does not restore edits over active recognition, and enables recovery after the lease ends', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '识别前的修改');
    const server = {
      ...job(),
      status: 'PROCESSING',
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    };
    session.open(server);
    expect(session.canRecoverLocal()).toBe(false);
    session.resolveRecovery('local');
    expect(session.getSnapshot().recovery).not.toBeNull();
    session.open({ ...server, leaseUntil: '2000-01-01T00:00:00.000Z' });
    expect(session.getSnapshot()).toMatchObject({ restored: true, dirty: true, recovery: null });
  });

  it('keeps saving functional when browser storage is unavailable', async () => {
    const session = new ImportDraftSession(() => {
      throw new Error('SecurityError');
    });
    session.open(job());
    rename(session, '无法本地备份');
    expect(session.getSnapshot().backupFailed).toBe(true);
    await session.confirm(first, async (current) => ({ ...current, version: 4 }));
    expect(session.getSnapshot()).toMatchObject({
      dirty: false,
      saveFailed: false,
      backupFailed: true,
    });
  });

  it('does not restore or edit archived imports while allowing review navigation', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    session.open(job());
    rename(session, '归档前的本地修改');
    const archived = { ...job(), version: 4, archivedAt: '2026-10-26T06:00:00.000Z' };
    session.open(archived);
    expect(session.canRecoverLocal()).toBe(false);
    session.resolveRecovery('local');
    expect(session.getSnapshot().job?.items[0].data.name).toBe('');
    session.resolveRecovery('server');
    rename(session, '归档后不允许修改');
    session.select(second);
    expect(session.getSnapshot()).toMatchObject({ dirty: false, activeId: second });
    expect(session.getSnapshot().job?.items[0].data.name).toBe('');
  });

  it('removes only the deleted import backup and resumes another import independently', () => {
    const storage = memoryStorage();
    const session = new ImportDraftSession(() => storage);
    const one = job();
    const two = { ...job(), id: 'import-2' };
    session.open(one);
    rename(session, '第一张的修改');
    session.open(two);
    session.select(third);
    session.clear();
    expect(session.lastId()).toBeNull();
    session.open(one);
    expect(session.getSnapshot().job?.items[0].data.name).toBe('第一张的修改');
    expect(session.getSnapshot().restored).toBe(true);
    session.open(two);
    expect(session.getSnapshot()).toMatchObject({ dirty: false, activeId: first });
  });
});
