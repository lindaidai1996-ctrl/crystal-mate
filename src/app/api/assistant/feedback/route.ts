import { NextRequest } from 'next/server';
import { withAuditRoute } from '@/lib/audit-route';
import { saveAssistantConversationFeedback } from '@/lib/ai-assistant/conversation-service';
import { assistantHttpError, assistantJson, assistantRequestBody } from '@/lib/ai-assistant/http';

export const runtime = 'nodejs';
export const POST = withAuditRoute(async (request: NextRequest) => {
  try {
    return assistantJson(
      await saveAssistantConversationFeedback(request, await assistantRequestBody(request)),
      201,
    );
  } catch (error) {
    return assistantHttpError(error);
  }
});
