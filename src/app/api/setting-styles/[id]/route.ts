import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { settingStyleSchema } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    const data = settingStyleSchema.parse(await request.json());
    const current = await db.settingStyle.findUnique({ where: { id } });
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(await db.settingStyle.update({ where: { id }, data }));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    const style = await db.settingStyle.findUnique({
      where: { id },
      include: { _count: { select: { cabochons: true } } },
    });
    if (!style) throw new ApiError(404, 'NOT_FOUND');
    if (style._count.cabochons) throw new ApiError(409, 'SETTING_STYLE_IN_USE');
    await db.settingStyle.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
