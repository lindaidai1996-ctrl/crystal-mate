import type { ProductSourceInput } from '../client-types';
import { calculateCostTotal, type CabochonCostValues } from '../cabochon-cost';
import {
  calculateDiyCost,
  calculateDiyQuote,
  craftDesignFeeTotal,
  emptyCraftDesignFee,
  runAmountToCents,
} from '../product-diy-cost';
import type { PriceContext } from './contracts';
export type SchemeSource = {
  origin: 'PURCHASED' | 'DIY' | null;
  purchaseEntries: Array<{ id: string; createdAt: string | Date; unitCost: string }>;
  diyRuns: Array<{
    id: string;
    createdAt: string | Date;
    perUnitCost: string;
    perUnitQuote?: string | null;
    quantity: number;
    craftDesignFee: unknown;
  }>;
};
function latest<T extends { id: string; createdAt: string | Date }>(rows: T[]) {
  return [...rows].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id),
  )[0];
}
export function priceContext(
  isCabochon: boolean,
  cost: CabochonCostValues | null | undefined,
  source: SchemeSource | ProductSourceInput,
  direct: string | null,
): PriceContext {
  let amount: string | null = null,
    quote: string | null = null,
    withLabor: string | null = null;
  const diy = !isCabochon && source.origin === 'DIY';
  if (isCabochon)
    amount = cost ? (cost.totalManual ? cost.totalCost : calculateCostTotal(cost)) : null;
  else if (source.origin === 'PURCHASED')
    amount =
      'purchaseEntries' in source
        ? (latest(source.purchaseEntries)?.unitCost ?? null)
        : source.unitCost || null;
  else if (diy) {
    const run = 'diyRuns' in source ? latest(source.diyRuns) : null;
    amount =
      'diyRuns' in source
        ? (run?.perUnitCost ?? null)
        : (calculateDiyCost(source)?.perUnitCost ?? null);
    quote =
      'diyRuns' in source
        ? (run?.perUnitQuote ?? null)
        : (calculateDiyQuote(source)?.perUnitQuote ?? null);
    const quantity = 'diyRuns' in source ? run?.quantity : source.quantity;
    const fee =
      'diyRuns' in source ? run?.craftDesignFee : (source.craftDesignFee ?? emptyCraftDesignFee());
    if (
      amount !== null &&
      quantity &&
      fee &&
      typeof fee === 'object' &&
      'unitAmount' in fee &&
      'accumulateByQuantity' in fee
    ) {
      const total = craftDesignFeeTotal(fee as ReturnType<typeof emptyCraftDesignFee>, quantity);
      const base = runAmountToCents(amount),
        labor = total === null ? null : runAmountToCents(total);
      if (base !== null && labor !== null) {
        // Preserve the exact division until the formula's final rounding.
        withLabor = `${base * BigInt(quantity) + labor}/${BigInt(100) * BigInt(quantity)}`;
      }
    }
  }
  return {
    values: { cost: amount, costWithLabor: withLabor, quote, direct },
    applicable: diy ? ['cost', 'costWithLabor', 'quote', 'direct'] : ['cost', 'direct'],
  };
}
