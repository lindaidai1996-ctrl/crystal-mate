import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { imageTypeFromBytes, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    if (storageMode() !== 'local') throw new ApiError(404, 'NOT_FOUND');
    const form = await request.formData();
    const id = form.get('id');
    const file = form.get('file');
    if (
      typeof id !== 'string' ||
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > MAX_IMAGE_BYTES
    )
      throw new ApiError(400, 'INVALID_IMAGE');
    const grant = await db.uploadGrant.findUnique({ where: { id } });
    if (!grant || grant.uploadedAt || grant.expiresAt < new Date())
      throw new ApiError(400, 'INVALID_IMAGE');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedType = imageTypeFromBytes(bytes);
    if (
      !detectedType ||
      detectedType !== file.type ||
      !grant.objectKey.endsWith(
        detectedType === 'image/jpeg' ? '.jpg' : detectedType === 'image/png' ? '.png' : '.webp',
      )
    )
      throw new ApiError(400, 'INVALID_IMAGE');
    const path = join(process.cwd(), 'public', 'uploads', grant.objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
    await db.uploadGrant.update({ where: { id }, data: { uploadedAt: new Date() } });
    return NextResponse.json({ key: grant.objectKey, url: grant.url });
  } catch (error) {
    return apiError(error);
  }
}
