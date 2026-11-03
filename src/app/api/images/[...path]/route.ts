import { Readable } from 'node:stream';
import { NextRequest } from 'next/server';
import { ApiError, apiError, requireAdmin } from '@/lib/api';
import { cosConfig, MAX_IMAGE_BYTES, storageMode } from '@/lib/media';
import { imageObjectKeyPattern } from '@/lib/image-storage';

const contentTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    await requireAdmin(request);
    if (storageMode() !== 'cos') throw new ApiError(404, 'NOT_FOUND');
    const { path } = await params;
    if ((path.length !== 1 && path.length !== 3) || path.some((part) => part.includes('/')))
      throw new ApiError(404, 'NOT_FOUND');
    const key = path.length === 1 ? `images/${path[0]}` : path.join('/');
    if (!imageObjectKeyPattern.test(key)) throw new ApiError(404, 'NOT_FOUND');

    const { client, bucket, region } = cosConfig();
    const object = { Bucket: bucket, Region: region, Key: key };
    let metadata;
    try {
      metadata = await client.headObject(object);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404)
        throw new ApiError(404, 'NOT_FOUND');
      throw error;
    }
    const size = Number(metadata.headers?.['content-length']);
    if (!Number.isFinite(size) || size < 1 || size > MAX_IMAGE_BYTES)
      throw new ApiError(404, 'NOT_FOUND');

    const stream = client.getObjectStream(object) as Readable;
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': contentTypes[key.slice(key.lastIndexOf('.') + 1)],
        'Content-Length': String(size),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
