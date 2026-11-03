import { z } from 'zod';
import { cabochonImageKeyPattern } from '@/lib/image-storage';
import { nameTagMatchSchema } from '@/lib/name-tag-matching';

export const MAX_EXCEL_ROWS = 300;
export const MAX_EXCEL_BYTES = 50 * 1024 * 1024;
export const excelFields = [
  'nickname',
  'type',
  'style',
  'image',
  'roughStoneCost',
  'settingCost',
  'price',
  'correctedPrice',
  'measurement',
  'notes',
  'videoShot',
  'published',
  'sold',
] as const;
export type ExcelField = (typeof excelFields)[number];
export type ExcelValues = Record<ExcelField, string>;
export type ColumnMapping = Partial<Record<ExcelField, string>>;

export const emptyExcelValues = (): ExcelValues =>
  Object.fromEntries(excelFields.map((field) => [field, ''])) as ExcelValues;

export const excelValuesSchema = z.record(z.enum(excelFields), z.string().max(10000));
export const excelRowInputSchema = z.strictObject({
  rowNumber: z.number().int().min(1).max(1048576),
  values: excelValuesSchema,
  productName: z.string().max(120).nullable().optional(),
  sourceStyle: z.string().max(10000).optional(),
  styleChoice: z.enum(['AUTO', 'SELECT', 'NEW', 'NONE']).optional(),
  styleId: z.string().cuid().nullable().optional(),
  original: z
    .array(z.strictObject({ column: z.string().max(255), value: z.string().max(10000) }))
    .max(200),
  tagChoice: z.enum(['AUTO', 'SELECT', 'NONE']).default('AUTO'),
  tagId: z.string().cuid().nullable().default(null),
  tagIds: z.array(z.string().cuid()).max(100).optional(),
  tagMatch: nameTagMatchSchema
    .extend({ source: z.string().max(10000) })
    .nullable()
    .optional(),
  imageKeys: z
    .array(z.string().regex(cabochonImageKeyPattern))
    .max(12)
    .refine((keys) => new Set(keys).size === keys.length),
  imageErrors: z.array(z.string().max(300)).max(20),
  ignoreImageErrors: z.boolean().default(false),
});
export const excelRowSchema = excelRowInputSchema.extend({
  images: z.array(z.object({ objectKey: z.string(), url: z.string() })).max(12),
  receipt: z
    .object({
      productId: z.string(),
      code: z.string(),
      committedAt: z.string(),
      settingStyle: z
        .object({ id: z.string(), name: z.string(), created: z.boolean() })
        .nullable()
        .optional(),
    })
    .nullable(),
});
export type ExcelRowInput = z.infer<typeof excelRowInputSchema>;
export type ExcelRow = z.infer<typeof excelRowSchema>;
export const createExcelImportSchema = z.strictObject({
  id: z.uuid(),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileName: z.string().trim().min(1).max(255),
  sheetName: z.string().trim().min(1).max(255),
  rows: z
    .array(excelRowInputSchema)
    .min(1)
    .max(MAX_EXCEL_ROWS)
    .refine((rows) => new Set(rows.map((row) => row.rowNumber)).size === rows.length),
});
export const updateExcelRowSchema = z.strictObject({
  version: z.number().int().min(0),
  row: excelRowInputSchema,
  applySameStyle: z.boolean().optional(),
});
export const commitExcelRowSchema = z.strictObject({
  rowNumber: z.number().int().positive(),
  version: z.number().int().min(0),
});
export type ExcelImport = {
  id: string;
  fileHash: string;
  fileName: string;
  sheetName: string;
  version: number;
  rows: ExcelRow[];
  updatedAt: string;
};
export type ExcelImportSummary = {
  id: string;
  fileName: string;
  sheetName: string;
  updatedAt: string;
  total: number;
  committed: number;
};
