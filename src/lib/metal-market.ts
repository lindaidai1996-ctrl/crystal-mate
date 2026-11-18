export const METAL_HISTORY_START = '2012-06-05';
export const MARKET_REFRESH_COOLDOWN = 10_000;

export const marketMetals = {
  silver: { code: 'AGTD', instrument: 'Ag(T+D)', gramsPerUnit: 1000 },
  gold: { code: 'AUTD', instrument: 'Au(T+D)', gramsPerUnit: 1 },
} as const;
export type MarketMetal = keyof typeof marketMetals;

export type MetalQuote = {
  price: number;
  previousClose: number;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number;
  changePercent: number;
  updatedAt: string;
};

export type MetalPoint = { date: string; price: number };
export type MetalHistory = { from: string; to: string; points: MetalPoint[] };

export function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function monthsBefore(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function isMarketDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
