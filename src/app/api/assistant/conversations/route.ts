import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuditRoute } from '@/lib/audit-route';
import {
  createAssistantConversation,
  listAssistantConversations,
} from '@/lib/ai-assistant/conversation-service';
import { assistantHttpError, assistantJson, assistantRequestBody } from '@/lib/ai-assistant/http';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    return assistantJson(await listAssistantConversations(request, params));
  } catch (error) {
    return assistantHttpError(error);
  }
}
export const POST = withAuditRoute(async (request: NextRequest) => {
  try {
    z.strictObject({}).parse(await assistantRequestBody(request));
    const session = await createAssistantConversation(request);
    return assistantJson({ id: session.id, revision: session.revision }, 201);
  } catch (error) {
    return assistantHttpError(error);
  }
});
