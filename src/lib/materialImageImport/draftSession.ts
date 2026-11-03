import { z } from 'zod';
import { importDraftSchema, type ImageImport } from './contracts';
import { patchImportItem } from './materialDraft';

const prefix = 'crystal-mate:material-image-import:';
const lastKey = `${prefix}last`;

// A backup must also retain intermediate input that is not yet valid for a server save
// (for example a zero quantity or an unfinished amount). Validate its structure only.
function localStructure(schema: z.core.$ZodType): z.ZodType {
  if (schema instanceof z.ZodString) return z.string();
  if (schema instanceof z.ZodNumber) return z.number();
  if (schema instanceof z.ZodObject)
    return z.object(
      Object.fromEntries(
        Object.entries(schema.shape).map(([key, field]) => [
          key,
          localStructure(field as z.ZodType),
        ]),
      ),
    );
  if (schema instanceof z.ZodArray) return z.array(localStructure(schema.element));
  if (schema instanceof z.ZodNullable) return localStructure(schema.unwrap()).nullable();
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault)
    return localStructure(schema.unwrap()).optional();
  if (schema instanceof z.ZodPipe) return localStructure(schema.in);
  if (schema instanceof z.ZodUnion)
    return z.union(schema.options.map((option) => localStructure(option as z.ZodType)));
  return schema as z.ZodType;
}

const localDraftSchema = localStructure(importDraftSchema) as z.ZodType<
  z.infer<typeof importDraftSchema>
>;
const cursorSchema = z.object({
  format: z.literal(1),
  importId: z.string(),
  activeId: z.string().nullable(),
});
const dirtyBackupSchema = cursorSchema.extend({
  dirty: z.literal(true),
  draft: localDraftSchema,
});
const backupSchema = z.discriminatedUnion('dirty', [
  cursorSchema.extend({ dirty: z.literal(false) }),
  dirtyBackupSchema,
]);
type Backup = z.infer<typeof backupSchema>;
type DirtyBackup = z.infer<typeof dirtyBackupSchema>;
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SaveDraft = (job: ImageImport) => Promise<ImageImport>;

export type ImportDraftState = {
  job: ImageImport | null;
  activeId: string | null;
  dirty: boolean;
  saving: boolean;
  saveFailed: boolean;
  savedAt: string | null;
  backupFailed: boolean;
  restored: boolean;
  recovery: DirtyBackup | null;
};

function draftOf(job: ImageImport) {
  return {
    version: job.version,
    settings: job.settings,
    items: job.items.map(({ id, data }) => ({ id, data })),
  };
}

function sameContent(backup: DirtyBackup, job: ImageImport) {
  const schema = importDraftSchema.omit({ version: true });
  const local = schema.safeParse({ settings: backup.draft.settings, items: backup.draft.items });
  const remote = schema.safeParse({ settings: job.settings, items: draftOf(job).items });
  return (
    local.success && remote.success && JSON.stringify(local.data) === JSON.stringify(remote.data)
  );
}

export function nextPendingItem(job: ImageImport, afterId: string | null) {
  const index = job.items.findIndex((item) => item.id === afterId);
  return [...job.items.slice(index + 1), ...job.items.slice(0, Math.max(0, index))].find(
    (item) => !item.entryId && item.data.selected && !item.data.reviewed,
  )?.id;
}

export function canRestoreImport(job: ImageImport) {
  return !(
    job.archivedAt ||
    (job.status === 'PROCESSING' &&
      job.leaseUntil &&
      new Date(job.leaseUntil).getTime() > Date.now())
  );
}

// One synchronous session owns edits, backups and save acknowledgements. React only subscribes
// to snapshots, so confirming immediately after an edit cannot save an older render's values.
export class ImportDraftSession {
  private state: ImportDraftState = {
    job: null,
    activeId: null,
    dirty: false,
    saving: false,
    saveFailed: false,
    savedAt: null,
    backupFailed: false,
    restored: false,
    recovery: null,
  };
  private listeners = new Set<() => void>();

  constructor(private storage: StorageAccess = () => window.localStorage) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ImportDraftState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  lastId() {
    try {
      return this.storage().getItem(lastKey);
    } catch {
      return null;
    }
  }

  private persist() {
    const { job, activeId, dirty, recovery } = this.state;
    if (!job || recovery) return;
    try {
      const storage = this.storage();
      storage.setItem(
        `${prefix}${job.id}`,
        JSON.stringify({
          format: 1,
          importId: job.id,
          activeId,
          dirty,
          ...(dirty ? { draft: draftOf(job) } : {}),
        }),
      );
      storage.setItem(lastKey, job.id);
      if (this.state.backupFailed) this.update({ backupFailed: false });
    } catch {
      this.update({ backupFailed: true });
    }
  }

  accept(job: ImageImport) {
    const activeId = this.state.job?.id === job.id ? this.state.activeId : null;
    this.update({
      job,
      activeId: job.items.find((item) => item.id === activeId)?.id ?? job.items[0]?.id ?? null,
      dirty: false,
      saveFailed: false,
      savedAt: job.updatedAt ?? null,
      restored: false,
      recovery: null,
    });
    this.persist();
    return job;
  }

  open(job: ImageImport) {
    let backup: Backup | null = null;
    try {
      const raw = this.storage().getItem(`${prefix}${job.id}`);
      const result = backupSchema.safeParse(raw ? JSON.parse(raw) : null);
      if (result.success && result.data.importId === job.id) backup = result.data;
    } catch {
      this.update({ backupFailed: true });
    }
    const activeId = backup?.activeId ?? job.items[0]?.id ?? null;
    this.update({
      job,
      activeId,
      dirty: false,
      saveFailed: false,
      savedAt: job.updatedAt ?? null,
      restored: false,
      recovery: null,
    });
    // A lost response may already have saved this exact content. Do not resurrect it as dirty.
    if (backup?.dirty && !sameContent(backup, job)) {
      this.update({ recovery: backup });
      if (backup.draft.version === job.version && canRestoreImport(job))
        this.resolveRecovery('local');
      return;
    }
    this.update({
      activeId: job.items.find((item) => item.id === activeId)?.id ?? job.items[0]?.id ?? null,
    });
    this.persist();
  }

  offerRecovery(job: ImageImport) {
    const current = this.state.job;
    if (!current || current.id !== job.id) return;
    this.update({
      job,
      savedAt: job.updatedAt ?? null,
      recovery: {
        format: 1,
        importId: current.id,
        activeId: this.state.activeId,
        dirty: true,
        draft: draftOf(current),
      },
    });
  }

  resolveRecovery(choice: 'local' | 'server') {
    const { job, recovery } = this.state;
    if (!job || !recovery) return;
    if (choice === 'server') {
      this.accept(job);
      return;
    }
    if (!canRestoreImport(job)) return;
    // Explicitly choosing local may replace editable candidates, never committed stock records.
    const committed = job.items.filter((item) => item.entryId);
    const committedIds = new Set(committed.map((item) => item.id));
    const items = [
      ...committed,
      ...recovery.draft.items
        .filter((item) => !committedIds.has(item.id))
        .map((item) => ({ ...item, materialId: null, entryId: null })),
    ];
    if (items.length > 100) return;
    this.update({
      job: {
        ...job,
        settings: committed.length ? job.settings : recovery.draft.settings,
        items,
      },
      activeId: items.find((item) => item.id === recovery.activeId)?.id ?? items[0]?.id ?? null,
      dirty: true,
      saveFailed: false,
      restored: true,
      recovery: null,
    });
    this.persist();
  }

  canRecoverLocal() {
    const { job, recovery } = this.state;
    if (!job || !recovery || !canRestoreImport(job)) return false;
    const ids = new Set(job.items.filter((item) => item.entryId).map((item) => item.id));
    return ids.size + recovery.draft.items.filter((item) => !ids.has(item.id)).length <= 100;
  }

  edit(transform: (job: ImageImport) => ImageImport) {
    if (!this.state.job || this.state.job.archivedAt || this.state.saving || this.state.recovery)
      return;
    this.update({ job: transform(this.state.job), dirty: true, restored: false });
    this.persist();
  }

  select(id: string) {
    if (this.state.saving || this.state.recovery) return;
    if (!this.state.job?.items.some((item) => item.id === id)) return;
    this.update({ activeId: id });
    this.persist();
  }

  async save(remote: SaveDraft) {
    const { job, saving, recovery } = this.state;
    if (!job || saving || recovery) throw new Error('IMPORT_CONFLICT');
    this.update({ saving: true, saveFailed: false });
    try {
      const result = await remote(job);
      this.accept(result);
      this.update({ savedAt: result.updatedAt ?? new Date().toISOString() });
      return result;
    } catch (error) {
      this.update({ saveFailed: true });
      throw error;
    } finally {
      this.update({ saving: false });
    }
  }

  async confirm(id: string, remote: SaveDraft) {
    const { job, saving, recovery } = this.state;
    if (!job || saving || recovery || !job.items.some((item) => item.id === id && !item.entryId))
      return;
    this.select(id);
    this.edit((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, data: patchImportItem(item.data, { reviewed: true }) } : item,
      ),
    }));
    const result = await this.save(remote);
    const next = nextPendingItem(result, id);
    if (next) this.select(next);
  }

  clear() {
    const id = this.state.job?.id;
    try {
      const storage = this.storage();
      if (id) storage.removeItem(`${prefix}${id}`);
      if (storage.getItem(lastKey) === id) storage.removeItem(lastKey);
    } catch {
      this.update({ backupFailed: true });
    }
    this.update({ job: null, activeId: null, dirty: false, recovery: null, restored: false });
  }
}
