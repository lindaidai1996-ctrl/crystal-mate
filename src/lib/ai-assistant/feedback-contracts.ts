import { z } from 'zod';
import { catalogRefSchema, purchaseRefSchema } from './contracts';

export const feedbackTargetSchema = z
  .strictObject({
    item: catalogRefSchema,
    purchase: purchaseRefSchema.nullable(),
  })
  .superRefine((target, context) => {
    if (
      target.purchase &&
      (target.item.type === 'MATERIAL') !== (target.purchase.type === 'MATERIAL_PURCHASE')
    )
      context.addIssue({ code: 'custom', message: 'Mismatched target identity' });
  });
const base = z.strictObject({
  requestId: z.uuid(),
  conversationId: z.uuid(),
  executionId: z.uuid(),
  note: z.string().trim().max(2000).default(''),
});
export const assistantFeedbackKindSchema = z.enum([
  'should_include',
  'does_not_belong',
  'misunderstood',
]);
export const assistantFeedbackSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('should_include'), target: feedbackTargetSchema }),
  base.extend({ kind: z.literal('does_not_belong'), target: feedbackTargetSchema }),
  base.extend({
    kind: z.literal('misunderstood'),
    target: feedbackTargetSchema.nullable().default(null),
    note: z.string().trim().min(1).max(2000),
  }),
]);
export type AssistantFeedbackInput = z.infer<typeof assistantFeedbackSchema>;
