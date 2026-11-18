import { z } from 'zod';
import {
  isMarketDate,
  marketMetals,
  type MarketMetal,
  type MetalHistory,
  type MetalQuote,
} from './metal-market';

const quoteSchema = z.object({
  rc: z.literal(0),
  data: z.object({
    f57: z.enum(['AGTD', 'AUTD']),
    f59: z.number().int().min(0).max(6),
    f43: z.number().positive(),
    f60: z.number().positive(),
    f44: z.unknown().optional(),
    f45: z.unknown().optional(),
    f46: z.unknown().optional(),
    f86: z.number().int().min(946684800).max(4102444800),
  }),
});
const historySchema = z.object({
  rc: z.literal(0),
  data: z
    .object({
      code: z.enum(['AGTD', 'AUTD']),
      market: z.literal(118),
      klines: z.array(z.string()).max(6000),
    })
    .nullable(),
});

export function parseMetalQuote(body: unknown, metal: MarketMetal = 'silver'): MetalQuote {
  const { data } = quoteSchema.parse(body);
  if (data.f57 !== marketMetals[metal].code) throw new Error('Unexpected instrument');
  // Silver is CNY/kg; gold is already CNY/g. Both use f59 decimal precision.
  const divisor = 10 ** data.f59 * marketMetals[metal].gramsPerUnit;
  const optionalPrice = (value: unknown) =>
    typeof value === 'number' && value > 0 ? value / divisor : null;
  const price = data.f43 / divisor;
  const previousClose = data.f60 / divisor;
  return {
    price,
    previousClose,
    open: optionalPrice(data.f46),
    high: optionalPrice(data.f44),
    low: optionalPrice(data.f45),
    change: price - previousClose,
    changePercent: (price / previousClose - 1) * 100,
    updatedAt: new Date(data.f86 * 1000).toISOString(),
  };
}

export function parseMetalHistory(
  body: unknown,
  from: string,
  to: string,
  metal: MarketMetal = 'silver',
): MetalHistory {
  const { data } = historySchema.parse(body);
  if (data && data.code !== marketMetals[metal].code) throw new Error('Unexpected instrument');
  const prices = new Map<string, number>();
  for (const row of data?.klines ?? []) {
    const [date, , close] = row.split(',');
    const price = Number(close);
    if (!isMarketDate(date) || !Number.isFinite(price) || price <= 0)
      throw new Error('Invalid history');
    if (date >= from && date <= to) prices.set(date, price / marketMetals[metal].gramsPerUnit);
  }
  return {
    from,
    to,
    points: [...prices]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, price]) => ({ date, price })),
  };
}

async function fetchMarket(url: URL, revalidate: number) {
  const response = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Market provider unavailable');
  return response.json();
}

export async function getMetalQuote(metal: MarketMetal) {
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/get');
  url.search = new URLSearchParams({
    secid: `118.${marketMetals[metal].code}`,
    fields: 'f57,f59,f43,f44,f45,f46,f60,f86',
  }).toString();
  return parseMetalQuote(await fetchMarket(url, 30), metal);
}

export async function getMetalHistory(from: string, to: string, metal: MarketMetal) {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.search = new URLSearchParams({
    secid: `118.${marketMetals[metal].code}`,
    klt: '101',
    fqt: '0',
    beg: from.replaceAll('-', ''),
    end: to.replaceAll('-', ''),
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55',
  }).toString();
  return parseMetalHistory(await fetchMarket(url, 300), from, to, metal);
}
