import { z } from 'zod';
import { assistantQuerySchema, hardConditionsSchema, semanticConditionSchema } from './contracts';

export const ORCHESTRATION_VERSION = 'orchestration-v5';
const nullableHard = hardConditionsSchema.partial().extend({
  purchaseDate: hardConditionsSchema.shape.purchaseDate.unwrap().nullable().optional(),
  createdAt: hardConditionsSchema.shape.createdAt.unwrap().nullable().optional(),
  distributorIds: hardConditionsSchema.shape.distributorIds.unwrap().nullable().optional(),
  items: hardConditionsSchema.shape.items.unwrap().nullable().optional(),
  categories: hardConditionsSchema.shape.categories.unwrap().nullable().optional(),
  tagIds: hardConditionsSchema.shape.tagIds.unwrap().nullable().optional(),
  location: hardConditionsSchema.shape.location.unwrap().nullable().optional(),
});
export const planToolSchema = z
  .strictObject({
    subject: z.enum(['catalog', 'purchases']).optional(),
    itemTypes: assistantQuerySchema.shape.itemTypes.optional(),
    hard: nullableHard,
    // Each supplied concept replaces that concept, [] deletes it. Omitted concepts survive.
    semantic: z.strictObject({
      material: z.array(semanticConditionSchema).max(20).optional(),
      purpose: z.array(semanticConditionSchema).max(20).optional(),
      form: z.array(semanticConditionSchema).max(20).optional(),
      other: z.array(semanticConditionSchema).max(20).optional(),
    }),
    month: z.enum(['this_month', 'previous_month']).nullable().optional(),
    view: z
      .enum(['details', 'by_distributor', 'stock', 'purchase_remaining', 'distributors'])
      .optional(),
    clarification: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((value, ctx) => {
    for (const [concept, conditions] of Object.entries(value.semantic))
      if (conditions?.some((c) => c.concept !== concept))
        ctx.addIssue({ code: 'custom', message: 'Mismatched semantic concept' });
    if (value.month && value.hard.purchaseDate != null)
      ctx.addIssue({ code: 'custom', message: 'Conflicting date operations' });
  });
export const emptyToolSchema = z.strictObject({});
export type Plan = z.infer<typeof planToolSchema>;
export type QueryState = {
  query: z.infer<typeof assistantQuerySchema>;
  view: 'details' | 'by_distributor' | 'stock' | 'purchase_remaining' | 'distributors';
};
// R08 has two explicit follow-up phrases with different accounting scopes.
// Resolve these exact phrases in the backend; never let a model swap them or
// silently change the already established date/location/item selection.
export function normalizeAssistantFollowup(
  plan: Plan,
  text: string,
  previous: QueryState | null,
): Plan {
  if (!previous || previous.view === 'distributors') return plan;
  const phrase = text.trim().replace(/[。？?!！]$/u, '');
  const view =
    phrase === '这些还剩多少'
      ? 'stock'
      : phrase === '这次买的还剩多少'
        ? 'purchase_remaining'
        : null;
  return view ? { hard: {}, semantic: {}, view, clarification: null } : plan;
}

export function applyAssistantPlan(
  previous: QueryState | null,
  input: unknown,
  now: Date,
): QueryState {
  const patch = planToolSchema.parse(input);
  const base = previous ?? {
    query: assistantQuerySchema.parse({
      version: 'v1',
      subject: 'purchases',
      itemTypes: ['MATERIAL', 'PRODUCT'],
      hard: {},
      semantic: [],
      ruleVersion: 'v1',
      pagination: { limit: 100 },
    }),
    view: 'details',
  };
  const hard = { ...base.query.hard } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch.hard)) {
    if (value === null) delete hard[key];
    else hard[key] = value;
  }
  if (patch.month) {
    const date = new Date(now.getTime() + 8 * 3600_000);
    const month = date.getUTCMonth() - (patch.month === 'previous_month' ? 1 : 0);
    const from = new Date(Date.UTC(date.getUTCFullYear(), month, 1));
    const to = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 1));
    hard.purchaseDate = {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  }
  const semantic = base.query.semantic.filter((c) => patch.semantic[c.concept] === undefined);
  semantic.push(...Object.values(patch.semantic).flatMap((c) => c ?? []));
  return {
    query: assistantQuerySchema.parse({
      ...base.query,
      subject: patch.subject ?? base.query.subject,
      itemTypes: patch.itemTypes ?? base.query.itemTypes,
      hard,
      semantic,
      pagination: { limit: 100 },
    }),
    view: patch.view ?? base.view,
  };
}
export const orchestrationBudgetSchema = z.strictObject({
  maxCalls: z.number().int().min(1).max(20).default(6),
  maxReservedTokens: z.number().int().min(1).max(500_000).default(100_000),
  timeoutMs: z.number().int().min(1).max(120_000).default(90_000),
  callTimeoutMs: z.number().int().min(1).max(60_000).default(30_000),
});
export const assistantStatusSchema = z.enum([
  'completed',
  'no_results',
  'needs_confirmation',
  'query_failed',
  'model_failed',
  'incomplete',
  'budget',
  'timeout',
  'cancelled',
]);
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;
