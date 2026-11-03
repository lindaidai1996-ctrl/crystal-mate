import { z } from 'zod';
import { materialCreateSchema } from '@/lib/validation';
import type { ImageImport } from './contracts';
import { validateMaterialImport } from './materialInput';
import {
  importValidationIssues,
  uniqueImportIssues,
  type ImportValidationIssue,
} from './validationIssues';

const settingsSchema = z.object({
  distributorId: materialCreateSchema.shape.distributorId,
  selection: materialCreateSchema.shape.selection,
});

export type ImportValidation = {
  settings: ImportValidationIssue[];
  items: { id: string; number: number; name: string; issues: ImportValidationIssue[] }[];
};

export function validateImageImport(job: ImageImport): ImportValidation {
  if (!job.items.some((item) => item.data.selected && !item.entryId))
    return { settings: [], items: [] };
  const parsedSettings = settingsSchema.safeParse(job.settings);
  const settings = parsedSettings.success
    ? []
    : importValidationIssues(parsedSettings.error.issues, job.settings);
  const items: ImportValidation['items'] = [];
  job.items.forEach((item, index) => {
    if (item.entryId || !item.data.selected) return;
    const result = validateMaterialImport(item.data, job.settings, 'pending-crop');
    const issues = result.issues.filter((issue) => issue.scope === 'item');
    if (issues.length)
      items.push({
        id: item.id,
        number: index + 1,
        name: item.data.material?.values.name ?? item.data.name,
        issues,
      });
  });
  return { settings: uniqueImportIssues(settings), items };
}
