import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const localeMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  if (['/silver', '/yj'].includes(request.nextUrl.pathname)) return NextResponse.next();
  return localeMiddleware(request);
}
export const config = { matcher: ['/((?!api|_next|uploads|.*\\..*).*)'] };
