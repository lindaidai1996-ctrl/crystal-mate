import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin, ApiError } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { MAX_IMAGE_BYTES } from '@/lib/media';
import { uploadCardBrandAsset } from '@/lib/product-cards/assets';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
export const POST = withAuditRoute(async (request: NextRequest) => {
  try {
    await requireAdmin(request);
    if (request.headers.get('content-type')?.includes('application/json')) {
      z.strictObject({ builtin: z.literal(true) }).parse(await request.json());
      const asset = await uploadCardBrandAsset(
        await readFile(join(process.cwd(), 'public/images/logo.png')),
      );
      return NextResponse.json({ id: asset.id }, { status: 201 });
    }
    const length = Number(request.headers.get('content-length'));
    if (length > MAX_IMAGE_BYTES + 64 * 1024) throw new ApiError(400, 'INVALID_IMAGE');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_IMAGE_BYTES)
      throw new ApiError(400, 'INVALID_IMAGE');
    const asset = await uploadCardBrandAsset(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ id: asset.id }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
});
