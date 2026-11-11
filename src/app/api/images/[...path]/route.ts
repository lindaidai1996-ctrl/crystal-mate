import { NextRequest } from 'next/server';
import { ApiError, apiError, requireAdmin } from '@/lib/api';
import { storageImage } from '@/lib/cached-storage-image';
import { IMAGE_CACHE_SECONDS } from '@/lib/image-cache';
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
    const { path } = await params;
    if ((path.length !== 1 && path.length !== 3) || path.some((part) => part.includes('/')))
      throw new ApiError(404, 'NOT_FOUND');
    const key = path.length === 1 ? `images/${path[0]}` : path.join('/');
    if (!imageObjectKeyPattern.test(key)) throw new ApiError(404, 'NOT_FOUND');

    // Fixed sizes prevent arbitrary queries from creating unlimited disk variants.
    const widthParam = request.nextUrl.searchParams.get('w');
    if (widthParam !== null && widthParam !== '128' && widthParam !== '640')
      throw new ApiError(400, 'INVALID_INPUT');
    const width = widthParam === '128' ? 128 : widthParam === '640' ? 640 : undefined;
    const { bytes, etag, contentType } = await storageImage(key, width);
    const headers = new Headers({
      'Content-Type': contentType ?? contentTypes[key.slice(key.lastIndexOf('.') + 1)],
      'Cache-Control': `private, max-age=${IMAGE_CACHE_SECONDS}, immutable`,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    const validators = request.headers.get('if-none-match')?.split(',') ?? [];
    if (
      validators.some((value) => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')
    )
      return new Response(null, { status: 304, headers });
    headers.set('Content-Length', String(bytes.length));
    return new Response(new Uint8Array(bytes), { headers });
  } catch (error) {
    return apiError(error);
  }
}
