import { z } from 'zod';
import {
  catalogRefSchema,
  purchaseRefSchema,
  entityRefSchema,
  queryCandidateSchema,
} from './contracts';

export const CANDIDATE_LIMIT = 5000;
export const CANDIDATE_RUN_TTL_MS = 10 * 60 * 1000;
export class CandidateQueryError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const candidateDetailSchema = z.strictObject({
  candidate: queryCandidateSchema,
  code: z.string().nullable(),
  batch: z.strictObject({ type: z.literal('BATCH'), id: entityRefSchema.shape.id }).nullable(),
  distributor: z
    .strictObject({ type: z.literal('DISTRIBUTOR'), id: entityRefSchema.shape.id })
    .nullable(),
});
export const candidateDetailsQuerySchema = z.strictObject({
  runId: z.uuid(),
  candidates: z
    .array(z.strictObject({ item: catalogRefSchema, purchase: purchaseRefSchema.nullable() }))
    .min(1)
    .max(100),
});
export const candidateDetailsResultSchema = z.strictObject({
  runId: z.uuid(),
  queriedAt: z.iso.datetime({ offset: true }),
  items: z.array(candidateDetailSchema).max(100),
});
export type CandidateDetail = z.infer<typeof candidateDetailSchema>;
