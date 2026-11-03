import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin, ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { cosConfig, imageTypes, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';
import { imageUploadPrefixes, imageUploadPurposes, imageStorageUrl } from '@/lib/image-storage';

const inputSchema = z.object({
  type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  purpose: z.enum(imageUploadPurposes).default('catalog'),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const input = inputSchema.parse(await request.json());
    const mode = storageMode();
    const key = `${imageUploadPrefixes[input.purpose]}/${randomUUID()}.${imageTypes[input.type]}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const url = imageStorageUrl(key, mode);
    let uploadUrl: string;
    if (mode === 'cos') {
      const { client, bucket, region } = cosConfig();
      uploadUrl = client.getObjectUrl({
        Bucket: bucket,
        Region: region,
        Key: key,
        Method: 'PUT',
        Sign: true,
        Expires: 300,
      });
      if (!uploadUrl) throw new ApiError(500, 'STORAGE_NOT_CONFIGURED');
    } else {
      uploadUrl = '/api/uploads/local';
    }
    const grant = await db.uploadGrant.create({ data: { objectKey: key, url, expiresAt } });
    return NextResponse.json({ id: grant.id, key, url, uploadUrl, mode });
  } catch (error) {
    return apiError(error);
  }
}
