import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { batchInclude, createBatch } from '@/lib/material-batches';
import { materialBatchWriteSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await db.materialBatch.findMany({
        include: batchInclude,
        orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
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
