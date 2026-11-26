import { z } from 'zod';

const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);

export const commonFeeIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/);
export const diyCommonFeesSchema = z
  .array(
    z.strictObject({
      id: commonFeeIdSchema,
      name: z.string().trim().min(1).max(60),
      amount: money,
      quoteAmount: money,
    }),
  )
  .max(50)
  .superRefine((fees, context) => {
    if (new Set(fees.map((fee) => fee.id)).size !== fees.length)
      context.addIssue({ code: 'custom', message: 'Duplicate fee IDs' });
    if (new Set(fees.map((fee) => fee.name)).size !== fees.length)
      context.addIssue({ code: 'custom', message: 'Duplicate fee names' });
  });

export type DiyCommonFee = z.infer<typeof diyCommonFeesSchema>[number];

export const DEFAULT_DIY_COMMON_FEES: DiyCommonFee[] = [
  { id: 'packaging', name: '包装费', amount: '10.00', quoteAmount: '10.00' },
  { id: 'shipping', name: '快递费', amount: '10.00', quoteAmount: '10.00' },
];

export const diyFeeQuantitySchema = z.number().int().positive().max(2147483647);

export type DiyExtraCost = {
  // Usage per finished item; legacy records without a quantity count as one.
  quantity?: number;
  name: string;
  amount: string;
  quoteAmount?: string | null;
  commonFeeId?: string;
};

// Selected fees are snapshots: editing or deleting a preset never changes an existing DIY.
export function commonFeeChoices(presets: DiyCommonFee[], costs: DiyExtraCost[]) {
  return [
    ...presets.map((preset) => {
      const selected = costs.find((cost) => cost.commonFeeId === preset.id);
      return selected ? { ...preset, name: selected.name } : preset;
    }),
    ...costs
      .filter((cost) => cost.commonFeeId && !presets.some((fee) => fee.id === cost.commonFeeId))
      .map((cost) => ({ ...cost, id: cost.commonFeeId!, quoteAmount: cost.quoteAmount ?? '' })),
  ];
}

export function toggleCommonFee(costs: DiyExtraCost[], fee: DiyCommonFee, enabled: boolean) {
  if (!enabled) return costs.filter((cost) => cost.commonFeeId !== fee.id);
  if (costs.some((cost) => cost.commonFeeId === fee.id)) return costs;
  return [
    ...costs,
    {
      commonFeeId: fee.id,
      name: fee.name,
      quantity: 1,
      amount: fee.amount,
      quoteAmount: fee.quoteAmount,
    },
  ];
}
