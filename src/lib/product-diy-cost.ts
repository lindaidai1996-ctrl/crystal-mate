import { amountToCents, centsToAmount } from './cabochon-cost';
import type { ProductSourceInput } from './client-types';
import { silverCostTotals } from './silver-cost';

export type CraftDesignFee = {
  unitAmount: string;
  accumulateByQuantity: boolean;
  // null follows the unit amount and quantity; a value preserves a manual total.
  totalAmount: string | null;
};

export function emptyCraftDesignFee(): CraftDesignFee {
  return { unitAmount: '0', accumulateByQuantity: false, totalAmount: null };
}

export function runAmountToCents(value: string): bigint | null {
  if (!/^\d{1,20}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}

export function craftDesignFeeTotal(fee: CraftDesignFee, quantity: number): string | null {
  const unit = amountToCents(fee.unitAmount);
  if (unit === null || !Number.isInteger(quantity) || quantity <= 0) return null;
  if (!fee.accumulateByQuantity) return centsToAmount(unit);
  const total =
    fee.totalAmount === null ? unit * BigInt(quantity) : runAmountToCents(fee.totalAmount);
  return total === null ? null : centsToAmount(total);
}

export function calculateDiyCost(input: Extract<ProductSourceInput, { origin: 'DIY' }>): {
  perUnitCost: string;
  totalCost: string;
} | null {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) return null;
  if (input.silverCost === null) return null;
  let perUnit = BigInt(0);
  if (input.silverCost) {
    const silver = silverCostTotals(input.silverCost);
    if (!silver) return null;
    perUnit += runAmountToCents(silver.cost)!;
  }
  for (const line of [...input.materials, ...input.cabochons]) {
    const quantity = amountToCents(String(line.quantity));
    const cost = amountToCents(line.unitCost);
    if (quantity === null || cost === null) return null;
    perUnit += (quantity * cost + BigInt(50)) / BigInt(100);
  }
  for (const line of input.extraCosts) {
    const cost = amountToCents(line.amount);
    if (cost === null) return null;
    perUnit += cost;
  }
  return {
    perUnitCost: centsToAmount(perUnit),
    totalCost: centsToAmount(perUnit * BigInt(input.quantity)),
  };
}

export function diyQuoteLineTotal(quantity: string | number, unitPrice: string | null | undefined) {
  const count = amountToCents(String(quantity));
  const price = unitPrice == null ? null : amountToCents(unitPrice);
  return count === null || count <= BigInt(0) || price === null
    ? null
    : centsToAmount((count * price + BigInt(50)) / BigInt(100));
}

export function calculateDiyQuote(input: Extract<ProductSourceInput, { origin: 'DIY' }>) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) return null;
  if (input.silverCost === null) return null;
  let perUnit = BigInt(0);
  if (input.silverCost) {
    const silver = silverCostTotals(input.silverCost);
    if (!silver) return null;
    perUnit += runAmountToCents(silver.quote)!;
  }
  for (const line of [...input.materials, ...input.cabochons]) {
    const total = diyQuoteLineTotal(line.quantity, line.quoteUnitPrice);
    if (total === null) return null;
    perUnit += runAmountToCents(total)!;
  }
  for (const line of input.extraCosts) {
    const amount = line.quoteAmount == null ? null : amountToCents(line.quoteAmount);
    if (amount === null) return null;
    perUnit += amount;
  }
  const fee = craftDesignFeeTotal(input.craftDesignFee ?? emptyCraftDesignFee(), input.quantity);
  if (fee === null) return null;
  const quantity = BigInt(input.quantity);
  const total = perUnit * quantity + runAmountToCents(fee)!;
  // Both values fit the quote snapshot columns, including very large valid runs.
  if (total > BigInt('9999999999999999999999')) return null;
  return {
    perUnitQuote: centsToAmount((total * BigInt(2) + quantity) / (quantity * BigInt(2))),
    totalQuote: centsToAmount(total),
  };
}
