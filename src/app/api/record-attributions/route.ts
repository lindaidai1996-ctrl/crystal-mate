import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { auditEntityTypes } from '@/lib/audit';
import { db } from '@/lib/db';

const query = z.object({
  entityType: z.enum(auditEntityTypes),
  ids: z
    .string()
    .max(20000)
    .transform((value) => value.split(','))
    .pipe(z.array(z.string().min(1).max(200)).min(1).max(100)),
});
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { entityType, ids } = query.parse(Object.fromEntries(request.nextUrl.searchParams));
    const items = await db.recordAttribution.findMany({
      where: { entityType, entityId: { in: ids } },
    });
    return NextResponse.json(items, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
