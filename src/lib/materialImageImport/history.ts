import type { ImageImport } from './contracts';

export function isImportHistory(job: ImageImport) {
  return !!job.archivedAt || (job.items.length > 0 && job.items.every((item) => !!item.entryId));
}
