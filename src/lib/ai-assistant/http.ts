import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from '@/lib/api';
import { CandidateQueryError } from './candidate-contracts';

export function assistantJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, x-assistant-privacy' },
  });
}
export function assistantHttpError(error: unknown) {
  if (error instanceof ApiError) return assistantJson({ error: error.code }, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError)
    return assistantJson({ error: 'INVALID_INPUT' }, 400);
  if (error instanceof CandidateQueryError)
    return assistantJson(
      { error: error.code },
      error.code === 'CONVERSATION_NOT_FOUND' ? 404 : 409,
    );
  // No database error, provider response, credential or stack is sent to the browser/log.
  return assistantJson({ error: 'ASSISTANT_REQUEST_FAILED' }, 500);
}
export async function assistantRequestBody(request: NextRequest) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(415, 'INVALID_CONTENT_TYPE');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_INPUT');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20000) {
        await reader.cancel();
        throw new ApiError(413, 'INPUT_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
