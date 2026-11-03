import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { settingStyleSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const items = await db.settingStyle.findMany({
      orderBy: { magicBoxStyle: 'asc' },
      include: { _count: { select: { cabochons: true } } },
    });
    return NextResponse.json(
      items.map(({ _count, ...item }) => ({ ...item, productCount: _count.cabochons })),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = settingStyleSchema.parse(await request.json());
    const item = await db.settingStyle.create({ data });
    return NextResponse.json({ ...item, productCount: 0 }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
