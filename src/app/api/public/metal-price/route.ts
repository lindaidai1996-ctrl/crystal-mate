import { NextRequest, NextResponse } from 'next/server';
import { isMarketDate, shanghaiDate, METAL_HISTORY_START } from '@/lib/metal-market';
import { marketService } from '@/lib/metal-market-service';

export async function GET(request: NextRequest) {
  const retryAfter = marketService.retryAfter(request.headers);
  if (retryAfter) {
    return NextResponse.json(
      { error: 'RATE_LIMITED' },
      {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) },
      },
    );
  }
  const params = request.nextUrl.searchParams;
  const metal = params.get('metal') ?? 'silver';
  const view = params.get('view') ?? 'quote';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (
    (metal !== 'silver' && metal !== 'gold') ||
    (view !== 'quote' && view !== 'history') ||
    (view === 'history' &&
      (!isMarketDate(from) ||
        !isMarketDate(to) ||
        from < METAL_HISTORY_START ||
        from > to ||
        to > shanghaiDate()))
  ) {
    return NextResponse.json(
      { error: 'INVALID_QUERY' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    const result = await marketService.read(metal, view, from, to);
    // Origin responses stay uncached so every request passes the limiter.
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'MARKET_UNAVAILABLE' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
