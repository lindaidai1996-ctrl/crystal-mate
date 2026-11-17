import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { readCardAsset } from '@/lib/product-cards/assets';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const bytes = await readCardAsset(
      z
        .string()
        .uuid()
        .parse((await params).id),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
