import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { updateExcelRowSchema } from '@/lib/cabochonExcelImport/contracts';
import { getExcelImport, updateExcelRow } from '@/lib/cabochonExcelImport/store';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getExcelImport(z.uuid().parse((await params).id)));
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await updateExcelRow(
        z.uuid().parse((await params).id),
        updateExcelRowSchema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
