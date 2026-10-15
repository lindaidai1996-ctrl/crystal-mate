import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { tagSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await db.tag.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true, materials: true } } },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = tagSchema.parse(await request.json());
    return NextResponse.json(await db.tag.create({ data }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
