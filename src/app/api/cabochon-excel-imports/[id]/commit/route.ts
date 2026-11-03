import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { commitExcelRowSchema } from '@/lib/cabochonExcelImport/contracts';
import { commitExcelRow } from '@/lib/cabochonExcelImport/store';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { rowNumber, version } = commitExcelRowSchema.parse(await request.json());
    return NextResponse.json(
      await commitExcelRow(z.uuid().parse((await params).id), rowNumber, version),
    );
  } catch (error) {
    return apiError(error);
  }
}
