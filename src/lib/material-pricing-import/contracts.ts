import { z } from 'zod';
import { procurementSchema } from '@/lib/material-pricing/purchase-contracts';

export const silverKinds = ['S925', 'FINE925', 'CHIANGMAI'] as const;
export type SilverKind = (typeof silverKinds)[number];
export type SilverColumnMapping = {
  date: string;
  supplier: string;
  orderAmount: string;
  lines: Record<SilverKind, { weight: string; quote: string; price: string; amount: string }>;
};
export const defaultSilverColumns: SilverColumnMapping = {
  date: 'A',
  supplier: 'N',
  orderAmount: 'L',
  lines: {
    S925: { weight: 'B', quote: 'C', price: 'D', amount: 'P' },
    FINE925: { weight: 'E', quote: 'F', price: 'G', amount: 'Q' },
    CHIANGMAI: { weight: 'H', quote: 'I', price: 'J', amount: 'R' },
  },
};
const cell = z.strictObject({
  value: z.string().max(10000),
  type: z.string().max(20),
  formula: z.string().max(10000).nullable(),
  cached: z.string().max(10000),
  formulaAttributes: z.record(z.string().max(100), z.string().max(1000)).optional(),
});
export const silverDraftLineSchema = z.strictObject({
  kind: z.enum(silverKinds),
  materialId: z.string().max(100).default(''),
  weight: z.string().max(100),
  quote: z.string().max(100).nullable(),
  amount: z.string().max(100),
  amountConfirmed: z.boolean().default(false),
  sourceWeight: z.string().max(100),
  sourcePrice: z.string().max(100),
  sourceAmount: z.string().max(100),
});
export const silverDraftRowSchema = z.strictObject({
  date1904: z.boolean().optional(),
  rowNumber: z.number().int().min(1).max(1048576),
  receivedAt: z.string().max(30),
  sourceSupplier: z.string().max(255),
  distributorId: z.string().max(100).default(''),
  original: z.record(z.string().regex(/^[A-Z]{1,3}$/), cell),
  lines: z
    .array(silverDraftLineSchema)
    .min(1)
    .max(3)
    .refine((lines) => new Set(lines.map((line) => line.kind)).size === lines.length),
  skipped: z.boolean().default(false),
  allowDuplicate: z.boolean().default(false),
  receipt: z
    .strictObject({ batchId: z.string(), entryIds: z.array(z.string()), committedAt: z.string() })
    .nullable()
    .default(null),
});
export const createSilverImportSchema = z.strictObject({
  id: z.uuid(),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileName: z.string().min(1).max(255),
  sheetName: z.string().min(1).max(255),
  rows: z
    .array(silverDraftRowSchema.omit({ receipt: true }))
    .min(1)
    .max(300)
    .refine((rows) => new Set(rows.map((row) => row.rowNumber)).size === rows.length),
});
export const updateSilverImportSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  row: silverDraftRowSchema.omit({ receipt: true }),
});
export const commitSilverImportSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  rowNumber: z.number().int().positive(),
});
export const startSilverImportSchema = z.union([
  z.strictObject({
    version: z.number().int().nonnegative(),
    rowNumbers: z
      .array(z.number().int().positive())
      .min(1)
      .max(300)
      .refine((rows) => new Set(rows).size === rows.length),
  }),
  z.strictObject({ version: z.number().int().nonnegative(), resume: z.literal(true) }),
]);
export const silverExecutionSchema = z.strictObject({
  token: z.uuid(),
  status: z.enum(['RUNNING', 'COMPLETED', 'INTERRUPTED']),
  rowNumbers: z.array(z.number().int().positive()).max(300),
  completed: z.array(z.number().int().positive()).max(300),
  failures: z
    .array(z.strictObject({ rowNumber: z.number().int().positive(), code: z.string() }))
    .max(300),
  leaseUntil: z.iso.datetime(),
});
export type SilverExecution = z.infer<typeof silverExecutionSchema>;
export type SilverImportProgress = Omit<SilverExecution, 'token' | 'leaseUntil'>;
export function silverImportProgress(raw: unknown, now = Date.now()): SilverImportProgress | null {
  if (raw == null) return null;
  const { token: _token, leaseUntil, ...progress } = silverExecutionSchema.parse(raw);
  void _token;
  return {
    ...progress,
    status:
      progress.status === 'RUNNING' && Date.parse(leaseUntil) <= now
        ? 'INTERRUPTED'
        : progress.status,
  };
}
export type SilverDraftRow = z.infer<typeof silverDraftRowSchema>;
export type SilverDraftLine = z.infer<typeof silverDraftLineSchema>;
export type SilverIssue = { code: string; kind?: SilverKind };
export type SilverReviewedRow = SilverDraftRow & {
  issues: SilverIssue[];
  similarBatchIds: string[];
};
export type SilverImport = {
  id: string;
  fileHash: string;
  fileName: string;
  sheetName: string;
  version: number;
  rows: SilverReviewedRow[];
  updatedAt: string;
  progress: SilverImportProgress | null;
};
export type SilverImportSummary = {
  id: string;
  fileName: string;
  sheetName: string;
  total: number;
  committed: number;
  updatedAt: string;
  progress: SilverImportProgress | null;
};
export function silverProcurement(row: SilverDraftRow) {
  return procurementSchema.safeParse({
    receivedAt: row.receivedAt,
    distributorId: row.distributorId,
    initialStock: 'UNKNOWN',
    notes: '',
    lines: row.lines.map((line) => ({
      materialId: line.materialId,
      weight: line.weight,
      quote: line.quote === '' ? null : line.quote,
      quotePurpose: 'BEFORE_DISCOUNT',
      amount: line.amount,
    })),
  });
}
