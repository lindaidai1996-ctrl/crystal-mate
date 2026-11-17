import { z } from 'zod';
import type { Material, Product } from '@/lib/client-types';

const dimension = z.coerce.number().finite().min(0).max(100000).optional();
export const pickerFiltersSchema = z
  .object({
    q: z.string().trim().max(120).default(''),
    source: z.enum(['all', 'recent']).default('all'),
    categoryId: z.string().cuid().optional(),
    tagId: z.string().cuid().optional(),
    distributorId: z.string().cuid().optional(),
    excludeProductId: z.string().cuid().optional(),
    stock: z.enum(['all', 'available']).default('all'),
    lengthMin: dimension,
    lengthMax: dimension,
    widthMin: dimension,
    widthMax: dimension,
    heightMin: dimension,
    heightMax: dimension,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(24).default(24),
  })
  .superRefine((value, context) => {
    for (const field of ['length', 'width', 'height'] as const) {
      const min = value[`${field}Min`];
      const max = value[`${field}Max`];
      if (min !== undefined && max !== undefined && min > max) {
        context.addIssue({
          code: 'custom',
          path: [`${field}Max`],
          message: 'Maximum must not precede minimum',
        });
      }
    }
  });
export type PickerFilters = z.infer<typeof pickerFiltersSchema>;
export type PickerKind = 'materials' | 'cabochons';
export type PickerPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type MaterialPickerPage = PickerPage<Material>;
export type CabochonPickerPage = PickerPage<Product>;
export type PickerSelection =
  | { kind: 'materials'; material: Material; entry: Material['batchEntries'][number] }
  | { kind: 'cabochons'; product: Product };

export function selectionId(selection: PickerSelection) {
  return selection.kind === 'materials' ? selection.entry.id : selection.product.id;
}
