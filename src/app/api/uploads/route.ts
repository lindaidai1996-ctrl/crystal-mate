import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin, ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { cosConfig, imageTypes, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';

const inputSchema = z.object({
  type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const input = inputSchema.parse(await request.json());
    const mode = storageMode();
    const key = `images/${randomUUID()}.${imageTypes[input.type]}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    let url: string;
    let uploadUrl: string;
    if (mode === 'cos') {
      const { client, bucket, region } = cosConfig();
      url = `/api/images/${key.slice('images/'.length)}`;
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
      url = `/uploads/${key}`;
      uploadUrl = '/api/uploads/local';
    }
    const grant = await db.uploadGrant.create({ data: { objectKey: key, url, expiresAt } });
    return NextResponse.json({ id: grant.id, key, url, uploadUrl, mode });
  } catch (error) {
    return apiError(error);
  }
}
