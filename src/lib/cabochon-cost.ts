export type OtherCost = { name: string; amount: string | null };

export type CabochonCostValues = {
  roughStoneCost: string | null;
  settingCost: string | null;
  otherCosts: OtherCost[];
  totalCost: string | null;
  totalManual: boolean;
};

const amountPattern = /^\d{1,10}(?:\.\d{1,2})?$/;
const maximumCents = BigInt('999999999999');

export function amountToCents(value: string): bigint | null {
  if (!amountPattern.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}

export function centsToAmount(value: bigint): string {
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}

export function normalizeCostAmount(value: string | null): string | null {
  if (value === null) return null;
  const cents = amountToCents(value);
  return cents === null ? value : centsToAmount(cents);
}

export function calculateCostTotal(cost: CabochonCostValues): string | null {
  const amounts = [
    cost.roughStoneCost,
    cost.settingCost,
    ...cost.otherCosts.map((item) => item.amount),
  ].filter((value): value is string => value !== null);
  if (!amounts.length) return null;
  const cents = amounts.reduce<bigint>((sum, amount) => {
    const value = amountToCents(amount);
    return value === null ? sum : sum + value;
  }, BigInt(0));
  return cents <= maximumCents ? centsToAmount(cents) : null;
}

export function hasCostInput(cost: CabochonCostValues): boolean {
  return (
    cost.roughStoneCost !== null ||
    cost.settingCost !== null ||
    cost.otherCosts.length > 0 ||
    (cost.totalManual && cost.totalCost !== null)
  );
}

export function recalculateCabochonCost(cost: CabochonCostValues): CabochonCostValues {
  return { ...cost, totalCost: calculateCostTotal(cost), totalManual: false };
}

export function withCostDetails(cost: CabochonCostValues): CabochonCostValues {
  return cost.totalManual ? cost : recalculateCabochonCost(cost);
}
