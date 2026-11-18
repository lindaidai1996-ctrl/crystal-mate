import { NextRequest } from 'next/server';
import { GET as getMetalPrice } from '../metal-price/route';

// Preserve the silver-only API, sharing its rate limit with the new API.
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.searchParams.set('metal', 'silver');
  return getMetalPrice(new NextRequest(url, { headers: request.headers }));
}
