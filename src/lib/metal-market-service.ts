import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { getMetalHistory, getMetalQuote } from './metal-market-provider';
import type { MarketMetal, MetalHistory, MetalQuote } from './metal-market';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const MAX_CLIENTS = 2000;
const MAX_CACHE_ENTRIES = 200;

// Both API paths share this guard and cache within one server process.
// Ingress must overwrite X-Real-IP; multiple processes need a shared limiter.
export function createMarketService() {
  const clients = new Map<string, { count: number; expires: number }>();
  const cache = new Map<string, { expires: number; result: Promise<MetalQuote | MetalHistory> }>();

  function retryAfter(headers: Headers) {
    const now = Date.now();
    const address = headers.get('x-real-ip')?.trim() ?? '';
    const key = isIP(address) ? createHash('sha256').update(address).digest('hex') : 'unknown';
    for (const [id, client] of clients) if (client.expires <= now) clients.delete(id);
    let client = clients.get(key);
    if (!client) {
      // Fail closed at capacity instead of evicting an active window.
      if (clients.size >= MAX_CLIENTS) return 60;
      client = { count: 0, expires: now + WINDOW_MS };
      clients.set(key, client);
    }
    if (client.count >= MAX_REQUESTS) return Math.max(1, Math.ceil((client.expires - now) / 1000));
    client.count++;
    return 0;
  }

  function read(metal: MarketMetal, view: 'quote' | 'history', from: string, to: string) {
    const now = Date.now();
    const key = view === 'quote' ? `${metal}:quote` : `${metal}:${from}:${to}`;
    for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
    const existing = cache.get(key);
    if (existing) return existing.result;
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    const entry = {
      expires: Infinity,
      result: (view === 'quote' ? getMetalQuote(metal) : getMetalHistory(from, to, metal))
        .then((result) => {
          entry.expires = Date.now() + (view === 'quote' ? 30_000 : 300_000);
          return result;
        })
        .catch(() => {
          entry.expires = Date.now() + 5000;
          throw new Error('MARKET_UNAVAILABLE');
        }),
    };
    cache.set(key, entry);
    return entry.result;
  }
  return { retryAfter, read };
}

export const marketService = createMarketService();
