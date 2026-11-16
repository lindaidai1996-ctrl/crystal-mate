import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { auditQuerySchema } from '@/lib/audit';
import { createdTimeWhere } from '@/lib/date-range';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const filters = auditQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const where: Prisma.AuditLogWhereInput = {
      ...createdTimeWhere(filters),
      ...(filters.actorId
        ? { actorId: filters.actorId === 'SYSTEM' ? null : filters.actorId }
        : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.operationId ? { operationId: filters.operationId } : {}),
      ...(filters.entityId
        ? {
            OR: [
              {
                entityId: filters.entityId,
                ...(filters.entityType ? { entityType: filters.entityType } : {}),
              },
              {
                rootId: filters.entityId,
                ...(filters.entityType ? { rootType: filters.entityType } : {}),
              },
              { relatedIds: { has: filters.entityId } },
            ],
          }
        : filters.entityType
          ? { OR: [{ entityType: filters.entityType }, { rootType: filters.entityType }] }
          : {}),
    };
    const [items, total, actors] = await db.$transaction([
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      db.auditLog.count({ where }),
      db.admin.findMany({
        select: { id: true, username: true, nickname: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const ids = [...new Set(items.flatMap((item) => item.relatedIds))];
    const references = ids.length
      ? await db.recordAttribution.findMany({
          where: { entityId: { in: ids } },
          select: { entityId: true, entityLabel: true },
        })
      : [];
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]));
    return NextResponse.json(
      {
        items: items.map((item) => {
          const actor = item.actorId ? actorsById.get(item.actorId) : undefined;
          return actor
            ? { ...item, actorUsername: actor.username, actorNickname: actor.nickname }
            : item;
        }),
        total,
        actors,
        references: Object.fromEntries(references.map((item) => [item.entityId, item.entityLabel])),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
