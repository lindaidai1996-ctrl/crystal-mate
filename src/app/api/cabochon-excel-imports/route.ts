import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { createExcelImportSchema } from '@/lib/cabochonExcelImport/contracts';
import { createExcelImport, listExcelImports } from '@/lib/cabochonExcelImport/store';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const query = z
      .object({
        fileHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        sheetName: z.string().max(255).optional(),
      })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listExcelImports(query.fileHash, query.sheetName));
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await createExcelImport(createExcelImportSchema.parse(await request.json())),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
