import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { deleteImportSchema, importDraftSchema } from '@/lib/materialImageImport/contracts';
import {
  deleteImageImport,
  getImageImport,
  saveImageImport,
} from '@/lib/materialImageImport/store';

type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    const { version } = deleteImportSchema.parse(await request.json());
    await deleteImageImport((await context.params).id, version);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getImageImport((await context.params).id));
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await saveImageImport(
        (await context.params).id,
        importDraftSchema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
