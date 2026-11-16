import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { auditContext } from './audit-context';

// Authentication stays inside each handler (and its existing error handling).
// requireAdmin fills this context only after server-side account verification.
export function withAuditRoute<Args extends [NextRequest, ...unknown[]], Result>(
  handler: (...args: Args) => Promise<Result>,
) {
  return (...args: Args): Promise<Result> =>
    auditContext.run(
      { operationId: randomUUID(), source: `${args[0].method} ${args[0].nextUrl.pathname}` },
      () => handler(...args),
    );
}
