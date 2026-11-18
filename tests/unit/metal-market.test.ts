import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getSilver } from '../../src/app/api/public/silver-price/route';
import { GET } from '../../src/app/api/public/metal-price/route';
import { createMarketService, marketService } from '../../src/lib/metal-market-service';
import { isMarketDate, monthsBefore, shanghaiDate } from '../../src/lib/metal-market';
import { parseMetalHistory, parseMetalQuote } from '../../src/lib/metal-market-provider';

const quote = {
  rc: 0,
  data: {
    f57: 'AGTD',
    f59: 2,
    f43: 1098100,
    f60: 1134500,
    f44: 1144300,
    f45: 1094800,
    f46: 1135300,
    f86: 1794971170,
  },
};
const history = {
  rc: 0,
  data: {
    code: 'AGTD',
    market: 118,
    klines: ['2025-12-31,10000,10125,10200,9900', '2026-01-02,10200,10350,10400,10100'],
  },
};
const fetchMock = vi.fn();
const request = (query = '') => new NextRequest(`http://localhost/api/public/metal-price${query}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T03:00:00Z'));
  const service = createMarketService();
  vi.spyOn(marketService, 'read').mockImplementation(service.read);
  vi.spyOn(marketService, 'retryAfter').mockImplementation(service.retryAfter);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public silver market data', () => {
  it('converts integer quote precision and kilograms to grams, and epoch seconds to the correct time', () => {
    const parsed = parseMetalQuote(quote);
    expect(parsed.price).toBe(10.981);
    expect(parsed.high).toBe(11.443);
    expect(parsed.open).toBe(11.353);
    expect(parsed.previousClose).toBe(11.345);
    expect(parsed.change).toBeCloseTo(-0.364);
    expect(parsed.changePercent).toBeCloseTo(-3.20846);
    expect(parsed.updatedAt).toBe(new Date(1794971170 * 1000).toISOString());
    expect(shanghaiDate(new Date(parsed.updatedAt))).toBe('2026-11-18');
  });

  it('does not fabricate a price when the market source has missing or invalid values', () => {
    for (const f43 of ['-', null, 0, -1])
      expect(() => parseMetalQuote({ ...quote, data: { ...quote.data, f43 } })).toThrow();
    expect(() => parseMetalQuote({ ...quote, data: { ...quote.data, f57: 'OTHER' } })).toThrow();
    expect(parseMetalQuote({ ...quote, data: { ...quote.data, f44: '-' } }).high).toBeNull();
  });

  it('keeps historical closes in the same unit across a year boundary and sorts the returned dates', () => {
    const parsed = parseMetalHistory(
      { ...history, data: { ...history.data, klines: [...history.data.klines].reverse() } },
      '2025-12-01',
      '2026-01-31',
    );
    expect(parsed.points).toEqual([
      { date: '2025-12-31', price: 10.125 },
      { date: '2026-01-02', price: 10.35 },
    ]);
    expect(parseMetalHistory(history, '2026-01-01', '2026-01-31').points).toHaveLength(1);
  });

  it('distinguishes an empty trading interval from invalid provider data', () => {
    expect(parseMetalHistory({ rc: 0, data: null }, '2026-11-14', '2026-11-15').points).toEqual([]);
    expect(() => parseMetalHistory({ rc: 1, data: null }, '2026-11-14', '2026-11-15')).toThrow();
    expect(() =>
      parseMetalHistory(
        { ...history, data: { ...history.data, klines: ['2026-02-30,10000,10000'] } },
        '2026-01-01',
        '2026-03-01',
      ),
    ).toThrow();
  });

  it('handles Beijing day boundaries, leap years and month-end presets', () => {
    expect(shanghaiDate(new Date('2026-11-17T17:00:00Z'))).toBe('2026-11-18');
    expect(monthsBefore('2024-03-31', 1)).toBe('2024-02-29');
    expect(monthsBefore('2024-02-29', 12)).toBe('2023-02-28');
    expect(monthsBefore('2026-01-31', 3)).toBe('2025-10-31');
    expect(isMarketDate('2026-02-30')).toBe(false);
  });

  it('serves the quote without cookies or an authenticated session, using a fixed upstream', async () => {
    fetchMock.mockImplementation(async () => Response.json(quote));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).price).toBe(10.981);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin).toBe('https://push2.eastmoney.com');
    expect(url.searchParams.get('secid')).toBe('118.AGTD');
    expect(options).not.toHaveProperty('headers');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fetches a cross-year history independently from the live quote', async () => {
    fetchMock.mockResolvedValue(Response.json(history));
    const response = await GET(request('?view=history&from=2025-12-01&to=2026-01-31'));
    expect(response.status).toBe(200);
    expect((await response.json()).points).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.origin).toBe('https://push2his.eastmoney.com');
    expect(url.searchParams.get('beg')).toBe('20251201');
    expect(url.searchParams.get('end')).toBe('20260131');
  });

  it.each([
    '?metal=platinum',
    '?metal=AUTD',
    '?view=other',
    '?view=history',
    '?view=history&from=2026-02-30&to=2026-03-10',
    '?view=history&from=2026-03-01&to=2026-02-01',
    '?view=history&from=2012-06-04&to=2026-11-18',
    '?view=history&from=2026-11-18&to=2026-11-19',
  ])('rejects invalid ranges before requesting the provider: %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe error on timeout, malformed data or provider rejection without leaking details', async () => {
    for (const failure of [
      new Error('private upstream detail'),
      Response.json({ rc: 1 }),
      new Response('', { status: 503 }),
    ]) {
      if (failure instanceof Error) fetchMock.mockRejectedValueOnce(failure);
      else fetchMock.mockResolvedValueOnce(failure);
      const response = await GET(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'MARKET_UNAVAILABLE' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      vi.advanceTimersByTime(5001);
    }
  });
});

describe('gold and silver protection', () => {
  const goldQuote = { ...quote, data: { ...quote.data, f57: 'AUTD', f43: 81484, f60: 83233 } };
  const goldHistory = {
    ...history,
    data: { ...history.data, code: 'AUTD', klines: ['2012-06-05,332.00,333.00,332.00,331.00'] },
  };

  it('keeps gold in CNY per gram without dividing by 1000, for live and historical prices', async () => {
    const parsed = parseMetalQuote(goldQuote, 'gold');
    expect(parsed.price).toBe(814.84);
    expect(parsed.previousClose).toBe(832.33);
    expect(parseMetalHistory(goldHistory, '2012-06-05', '2012-06-06', 'gold').points).toEqual([
      { date: '2012-06-05', price: 333 },
    ]);
    fetchMock
      .mockResolvedValueOnce(Response.json(goldQuote))
      .mockResolvedValueOnce(Response.json(goldHistory));
    expect((await (await GET(request('?metal=gold'))).json()).price).toBe(814.84);
    expect(
      (await (await GET(request('?metal=gold&view=history&from=2012-06-05&to=2012-06-06'))).json())
        .points[0].price,
    ).toBe(333);
    for (const [url] of fetchMock.mock.calls)
      expect(url.searchParams.get('secid')).toBe('118.AUTD');
    expect(() => parseMetalQuote(goldQuote, 'silver')).toThrow();
    expect(() => parseMetalQuote(quote, 'gold')).toThrow();
    expect(() => parseMetalHistory(history, '2025-12-01', '2026-01-31', 'gold')).toThrow();
  });

  it('deduplicates concurrent requests, caches per metal, and fetches again after expiry', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const first = GET(request());
    const second = GET(request());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(Response.json(quote));
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    await GET(request());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json(goldQuote));
    await GET(request('?metal=gold'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_001);
    fetchMock.mockResolvedValueOnce(Response.json(quote));
    await GET(request());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares a limit across metals, history and the legacy API, and recovers after the window', async () => {
    fetchMock.mockImplementation(async () => Response.json(quote));
    for (let i = 0; i < 30; i++) expect((await GET(request())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const query of ['?metal=gold', '?view=history&from=2026-11-01&to=2026-11-18']) {
      const response = await GET(request(query));
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: 'RATE_LIMITED' });
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect((await getSilver(request())).status).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect((await GET(request())).status).toBe(200);
  });

  it('isolates trusted ingress IPs and groups absent or malformed IPs in a fallback bucket', async () => {
    fetchMock.mockImplementation(async () => Response.json(quote));
    const withIP = (ip: string) =>
      new NextRequest('http://localhost/api/public/metal-price', { headers: { 'x-real-ip': ip } });
    for (let i = 0; i < 30; i++) await GET(withIP('192.0.2.1'));
    expect((await GET(withIP('192.0.2.1'))).status).toBe(429);
    expect((await GET(withIP('192.0.2.2'))).status).toBe(200);
    for (let i = 0; i < 30; i++) await GET(request());
    expect((await GET(withIP('untrusted-text'))).status).toBe(429);
  });

  it('backs off after upstream failures and retries after five seconds', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private details'));
    expect((await GET(request())).status).toBe(502);
    expect((await GET(request())).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5001);
    fetchMock.mockResolvedValueOnce(Response.json(quote));
    expect((await GET(request())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the legacy API silver-only even if a gold query is supplied', async () => {
    fetchMock.mockImplementation(async () => Response.json(quote));
    const response = await getSilver(request('?metal=gold'));
    expect(response.status).toBe(200);
    expect((await response.json()).price).toBe(10.981);
    expect(fetchMock.mock.calls[0][0].searchParams.get('secid')).toBe('118.AGTD');
  });
});
