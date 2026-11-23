import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { batchInclude, createBatch } from '@/lib/material-batches';
import { materialBatchWriteSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const batches = await db.materialBatch.findMany({
      include: {
        ...batchInclude,
        entries: {
          where: {
            OR: [{ material: { pricingGroupId: null } }, { material: { unit: { not: 'GRAM' } } }],
          },
          select: { id: true },
        },
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(
      batches.map(({ entries, ...batch }) => ({ ...batch, ordinaryEntryCount: entries.length })),
    );
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await createBatch(materialBatchWriteSchema.parse(await request.json())),
      {
        status: 201,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
