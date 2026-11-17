import { describe, expect, it, vi } from 'vitest';
vi.mock('@/auth', () => ({ auth: vi.fn() }));
import { NextRequest } from 'next/server';
import { acceptAssistantSnapshot } from '@/lib/ai-assistant/browser-contracts';
import { assistantBrowserView } from '@/lib/ai-assistant/browser-view';
import { assistantRequestBody, assistantHttpError } from '@/lib/ai-assistant/http';
import { CandidateQueryError } from '@/lib/ai-assistant/candidate-contracts';
import { newAssistantExecution } from '@/lib/ai-assistant/orchestrator';
import type { AssistantConversationStore } from '@/lib/ai-assistant/conversation-store';

function source() {
  const data = newAssistantExecution(null);
  data.clarification = 'cost 123.45';
  data.checkpoint = { private: 'must never leave server' };
  return {
    session: {
      id: 'own-session',
      revision: 3,
      ownerId: 'hidden-owner',
      activeExecutionId: 'exec',
      state: null,
    },
    latest: { id: 'exec', generation: 3, data, text: 'cost 123.45' },
    messages: [
      { id: 'message', role: 'user', content: { text: 'cost 123.45' }, executionId: 'exec' },
    ],
    interrupted: false,
    recovery: null,
  } as unknown as Awaited<ReturnType<AssistantConversationStore['read']>>;
}
describe('assistant browser boundary', () => {
  it('projects no checkpoint, owner, raw result, or cost-bearing prose in privacy mode', () => {
    const view = assistantBrowserView(source(), true);
    const json = JSON.stringify(view);
    expect(json).not.toContain('hidden-owner');
    expect(json).not.toContain('must never leave');
    expect(json).not.toContain('123.45');
    expect(view.messages[0].text).toBeNull();
    expect(view.active).toBe(true);
  });
  it('exposes authenticated message text only when privacy is explicitly off', () => {
    expect(assistantBrowserView(source(), false).messages[0].text).toBe('cost 123.45');
  });
  it('reports an expired lease as interrupted rather than running/success', () => {
    const input = source();
    input.interrupted = true;
    const view = assistantBrowserView(input, false);
    expect(view.active).toBe(false);
    expect(view.latest?.status).toBe('incomplete');
    expect(view.latest?.errorCode).toBe('EXECUTION_INTERRUPTED');
  });
  it('rejects old generations and responses from previously selected conversations', () => {
    expect(acceptAssistantSnapshot({ id: 'a', revision: 4 }, { id: 'a', revision: 3 }, 'a')).toBe(
      false,
    );
    expect(acceptAssistantSnapshot({ id: 'b', revision: 1 }, { id: 'a', revision: 5 }, 'b')).toBe(
      false,
    );
    expect(acceptAssistantSnapshot({ id: 'a', revision: 4 }, { id: 'a', revision: 5 }, 'a')).toBe(
      true,
    );
  });
  it('rejects oversized bodies without trusting Content-Length', async () => {
    const request = new NextRequest('http://localhost/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(20001) }),
    });
    await expect(assistantRequestBody(request)).rejects.toMatchObject({ status: 413 });
  });
  it('does not return arbitrary database/provider errors', async () => {
    expect(await assistantHttpError(new Error('secret upstream body')).json()).toEqual({
      error: 'ASSISTANT_REQUEST_FAILED',
    });
    const response = assistantHttpError(new CandidateQueryError('STALE_REVISION'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'STALE_REVISION' });
  });
});
