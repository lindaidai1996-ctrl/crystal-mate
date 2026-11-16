import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
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
    const [items, actors] = await db.$transaction([
      db.recordAttribution.findMany({
        where: { entityType, entityId: { in: ids } },
      }),
      db.admin.findMany({ select: { id: true, username: true, nickname: true } }),
    ]);
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]));
    const currentActor = (actor: Prisma.JsonValue) => {
      if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
        return typeof actor.id === 'string' ? actorsById.get(actor.id) || actor : actor;
      }
      return actor;
    };
    return NextResponse.json(
      items.map((item) => ({
        ...item,
        createdBy: currentActor(item.createdBy),
        updatedBy: currentActor(item.updatedBy),
      })),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
