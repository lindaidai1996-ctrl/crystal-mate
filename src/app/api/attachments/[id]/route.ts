import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { attachmentDetails } from '@/lib/shared-attachments';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await attachmentDetails(
        z
          .string()
          .min(1)
          .max(150)
          .parse((await context.params).id),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
