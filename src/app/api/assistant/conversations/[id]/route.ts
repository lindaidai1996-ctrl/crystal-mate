import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuditRoute } from '@/lib/audit-route';
import {
  commandAssistantConversation,
  deleteAssistantConversation,
  readAssistantBrowserConversation,
  renameAssistantConversation,
} from '@/lib/ai-assistant/conversation-service';
import { assistantHttpError, assistantJson, assistantRequestBody } from '@/lib/ai-assistant/http';

type Context = { params: Promise<{ id: string }> };
export const runtime = 'nodejs';
export const maxDuration = 150;
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return assistantJson(await readAssistantBrowserConversation(request, { conversationId: id }));
  } catch (error) {
    return assistantHttpError(error);
  }
}
export const POST = withAuditRoute(async (request: NextRequest, context: Context) => {
  try {
    const { id } = await context.params;
    const body = z.record(z.string(), z.unknown()).parse(await assistantRequestBody(request));
    // Route identity is authoritative; additional fields still meet the strict P4 schema.
    if ('conversationId' in body) throw new SyntaxError('INVALID_INPUT');
    await commandAssistantConversation(request, { ...body, conversationId: id });
    return assistantJson(await readAssistantBrowserConversation(request, { conversationId: id }));
  } catch (error) {
    return assistantHttpError(error);
  }
});

export const PATCH = withAuditRoute(async (request: NextRequest, context: Context) => {
  try {
    const { id } = await context.params;
    const body = z.strictObject({ title: z.string() }).parse(await assistantRequestBody(request));
    return assistantJson(
      await renameAssistantConversation(request, { conversationId: id, title: body.title }),
    );
  } catch (error) {
    return assistantHttpError(error);
  }
});

export const DELETE = withAuditRoute(async (request: NextRequest, context: Context) => {
  try {
    const { id } = await context.params;
    return assistantJson(await deleteAssistantConversation(request, { conversationId: id }));
  } catch (error) {
    return assistantHttpError(error);
  }
});
