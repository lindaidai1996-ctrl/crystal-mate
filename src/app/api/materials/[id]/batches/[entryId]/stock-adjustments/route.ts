import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { materialStockCountSchema } from '@/lib/validation';
import { adjustMaterialStock } from '@/lib/material-stock';

type Context = { params: Promise<{ id: string; entryId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id, entryId } = await params;
    const input = materialStockCountSchema.parse(await request.json());
    return NextResponse.json(await adjustMaterialStock(id, entryId, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
