import { z } from 'zod';

export const ownerSchema = z.strictObject({
  type: z.enum(['batch', 'distributor']),
  id: z.string().cuid(),
});
export const assetRefSchema = z.strictObject({
  id: z.string().min(1).max(150),
  version: z.number().int().positive(),
});
export const targetSchema = ownerSchema.extend({
  name: z.string(),
  related: z.boolean().optional(),
  receivedAt: z.string().optional(),
  reason: z.string().optional(),
});
export type AttachmentTarget = z.infer<typeof targetSchema>;
export type SharedAssetView = {
  version: number;
  imageVersion: number;
  distributors: { distributor: { id: string; name: string } }[];
  batches: { batch: { id: string; name: string } }[];
};
export const partySchema = z.strictObject({
  name: z.string().max(200).nullable(),
  phone: z.string().max(100).nullable(),
  address: z.string().max(400).nullable(),
});
export const receiptSchema = z.strictObject({
  documentType: z.string().max(80).nullable(),
  seller: partySchema,
  buyer: partySchema,
  dates: z
    .array(
      z.strictObject({
        value: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
          ),
        label: z.string().max(100),
      }),
    )
    .max(10),
  warnings: z.array(z.string().max(300)).max(15),
});
export type ReceiptEvidence = z.infer<typeof receiptSchema>;
export type ReceiptResult = {
  id: string;
  status: string;
  errorCode?: string | null;
  result?: ReceiptEvidence | null;
  suggestions: AttachmentTarget[];
  model: string;
  usage?: unknown;
};
