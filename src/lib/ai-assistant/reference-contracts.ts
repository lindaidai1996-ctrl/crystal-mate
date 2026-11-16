import { z } from 'zod';
import { entityRefSchema, fieldEvidenceSchema, hardConditionsSchema } from './contracts';

export const REFERENCE_SCAN_LIMIT = 5000;
export const locationQuerySchema = hardConditionsSchema.shape.location.unwrap();
export const dictionaryKindSchema = z.enum([
  'MATERIAL_CATEGORY',
  'PRODUCT_CATEGORY',
  'TAG',
  'DISTRIBUTOR',
]);
const dictionaryRefSchema = z.strictObject({ type: dictionaryKindSchema, id: z.string().cuid() });
const dictionaryLabelSchema = z.strictObject({ entity: dictionaryRefSchema, name: z.string() });
export const dictionaryQuerySchema = z.strictObject({
  text: z.string().trim().max(200).default(''),
  kinds: z
    .array(dictionaryKindSchema)
    .min(1)
    .max(4)
    .refine((values) => new Set(values).size === values.length, 'Duplicate dictionary kinds'),
  offset: z
    .number()
    .int()
    .min(0)
    .max(REFERENCE_SCAN_LIMIT * 4)
    .default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
export const locationMatchSchema = z.strictObject({
  distributor: entityRefSchema.extend({ type: z.literal('DISTRIBUTOR') }),
  name: z.string(),
  area: z.string(),
  reason: z.enum([
    'explicit_place',
    'exact_area',
    'area_only',
    'mention_only',
    'qualified_mention',
  ]),
  evidence: z
    .array(
      z
        .strictObject({
          field: z.enum(['name', 'address', 'area', 'notes']),
          matchedText: z.string().min(1),
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
        })
        .refine(({ start, end, matchedText }) => end - start === matchedText.length),
    )
    .min(1),
});
export const locationResolutionSchema = z
  .strictObject({
    version: z.literal('v1'),
    query: locationQuerySchema,
    status: z.enum(['resolved', 'needs_clarification', 'incomplete']),
    scannedCount: z.number().int().nonnegative(),
    scanComplete: z.boolean(),
    confirmed: z.array(locationMatchSchema),
    uncertain: z.array(locationMatchSchema),
  })
  .superRefine((result, ctx) => {
    const keys = [...result.confirmed, ...result.uncertain].map((row) => row.distributor.id);
    if (new Set(keys).size !== keys.length || keys.length > result.scannedCount)
      ctx.addIssue({ code: 'custom', message: 'Duplicate or inconsistent location matches' });
    if ((result.status === 'incomplete') === result.scanComplete)
      ctx.addIssue({ code: 'custom', message: 'Location scan status disagrees' });
    if (result.status === 'resolved' && !result.confirmed.length && result.uncertain.length)
      ctx.addIssue({ code: 'custom', message: 'Uncertain-only location requires clarification' });
    if (
      result.status === 'needs_clarification' &&
      (result.confirmed.length || !result.uncertain.length)
    )
      ctx.addIssue({ code: 'custom', message: 'Clarification requires uncertain-only matches' });
  });
export const dictionaryResultSchema = z
  .strictObject({
    version: z.literal('v1'),
    query: dictionaryQuerySchema,
    status: z.enum(['complete', 'incomplete']),
    scannedCount: z.number().int().nonnegative(),
    totalMatches: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
    items: z
      .array(
        z.strictObject({
          entity: dictionaryRefSchema,
          name: z.string(),
          aliases: z.array(z.string()),
          parentId: z.string().cuid().nullable(),
          ancestors: z.array(dictionaryLabelSchema),
          descendants: z.array(dictionaryLabelSchema),
          match: z.enum(['exact', 'contains', 'listed']),
          evidence: z.array(fieldEvidenceSchema),
        }),
      )
      .max(100),
  })
  .superRefine((result, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (result.status === 'incomplete') {
      if (result.totalMatches !== null || result.items.length || result.hasMore)
        issue('Incomplete scan must not claim matches or a complete tree');
    } else if (
      result.totalMatches === null ||
      result.items.length !==
        Math.min(result.query.limit, Math.max(0, result.totalMatches - result.query.offset)) ||
      result.hasMore !== result.query.offset + result.items.length < result.totalMatches
    )
      issue('Inconsistent dictionary page');
  });

export type LocationQuery = z.infer<typeof locationQuerySchema>;
export type LocationResolution = z.infer<typeof locationResolutionSchema>;
export type DictionaryQuery = z.infer<typeof dictionaryQuerySchema>;
export type DictionaryKind = z.infer<typeof dictionaryKindSchema>;
