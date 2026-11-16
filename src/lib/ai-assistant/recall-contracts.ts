import { z } from 'zod';
import { candidatePageSchema, fieldEvidenceSchema, candidateKey } from './contracts';
export const recallRouteSchema = z.enum([
  'name',
  'aliases',
  'category',
  'category_subtree',
  'tag',
  'notes',
  'full_scope',
]);
export const recallSourceSchema = z
  .strictObject({
    route: recallRouteSchema,
    terms: z.array(z.string()).max(300),
    evidence: z.array(fieldEvidenceSchema).max(200),
  })
  .superRefine((source, ctx) => {
    if (
      source.route === 'full_scope'
        ? source.terms.length || source.evidence.length
        : !source.terms.length || !source.evidence.length
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid recall source evidence' });
  });
export const recallPageSchema = candidatePageSchema
  .safeExtend({
    policyVersion: z.literal('v1'),
    sources: z
      .array(
        z.strictObject({ key: z.string(), sources: z.array(recallSourceSchema).min(1).max(7) }),
      )
      .max(100),
    sourceCounts: z
      .array(
        z.strictObject({
          route: recallRouteSchema,
          candidateCount: z.number().int().nonnegative(),
        }),
      )
      .max(7),
  })
  .superRefine((page, ctx) => {
    if (
      page.sources.length !== page.items.length ||
      page.sources.some(
        (row, i) =>
          row.key !== candidateKey(page.items[i]) ||
          new Set(row.sources.map((s) => s.route)).size !== row.sources.length ||
          row.sources.some((source) =>
            source.evidence.some(
              (e) =>
                !page.items[i].evidence.some(
                  (actual) => JSON.stringify(actual) === JSON.stringify(e),
                ),
            ),
          ),
      ) ||
      new Set(page.sourceCounts.map((s) => s.route)).size !== page.sourceCounts.length ||
      page.sourceCounts.find((s) => s.route === 'full_scope')?.candidateCount !==
        page.completeness.totalCandidates
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Recall provenance does not match returned candidates',
      });
  });
export type RecallSource = z.infer<typeof recallSourceSchema>;
export type RecallPage = z.infer<typeof recallPageSchema>;
