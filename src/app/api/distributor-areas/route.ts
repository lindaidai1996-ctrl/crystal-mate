import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { distributorAreaSchema } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = distributorAreaSchema.parse(await request.json());
    const area = await db.distributorArea.create({ data });
    return NextResponse.json(area, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
