import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { cosConfig, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    if (storageMode() !== 'cos') throw new ApiError(404, 'NOT_FOUND');
    const { id } = z.object({ id: z.string().cuid() }).parse(await request.json());
    const grant = await db.uploadGrant.findUnique({ where: { id } });
    if (!grant || grant.uploadedAt || grant.expiresAt < new Date())
      throw new ApiError(400, 'INVALID_IMAGE');
    const { client, bucket, region } = cosConfig();
    const metadata = await client.headObject({
      Bucket: bucket,
      Region: region,
      Key: grant.objectKey,
    });
    const size = Number(metadata.headers?.['content-length']);
    if (!Number.isFinite(size) || size < 1 || size > MAX_IMAGE_BYTES)
      throw new ApiError(400, 'INVALID_IMAGE');
    await db.uploadGrant.update({ where: { id }, data: { uploadedAt: new Date() } });
    return NextResponse.json({ key: grant.objectKey, url: grant.url });
  } catch (error) {
    return apiError(error);
  }
}
