import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  begin: vi.fn(),
  save: vi.fn(),
  finish: vi.fn(),
  list: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ requireAccount: mocks.requireAccount }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/ai-assistant/conversation-store', () => ({
  AssistantConversationStore: class {
    create = mocks.create;
    read = mocks.read;
    cancel = mocks.cancel;
    begin = mocks.begin;
    save = mocks.save;
    finish = mocks.finish;
    list = mocks.list;
    rename = mocks.rename;
    remove = mocks.remove;
  },
  minimizeAssistantText: (text: string) => text,
}));
import {
  createAssistantConversation,
  readAssistantConversation,
  commandAssistantConversation,
  renameAssistantConversation,
  deleteAssistantConversation,
  listAssistantConversations,
} from '@/lib/ai-assistant/conversation-service';
const id = 'f73234da-a4f2-44c5-a2eb-10e576c2f787';
const request = new NextRequest('http://localhost/api/assistant', { method: 'POST' });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccount.mockResolvedValue({ id: 'authenticated-owner' });
});
describe('authenticated conversation facade', () => {
  it('renames and deletes only with the authenticated owner and validates names', async () => {
    await renameAssistantConversation(request, { conversationId: id, title: '  采购记录  ' });
    expect(mocks.rename).toHaveBeenCalledWith('authenticated-owner', id, '采购记录');
    await deleteAssistantConversation(request, { conversationId: id });
    expect(mocks.remove).toHaveBeenCalledWith('authenticated-owner', id);
    for (const title of ['', '  ', '字'.repeat(81)]) {
      await expect(
        renameAssistantConversation(request, { conversationId: id, title }),
      ).rejects.toThrow();
    }
    await expect(
      deleteAssistantConversation(request, { conversationId: id, ownerId: 'other' }),
    ).rejects.toThrow();
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it('hides conversation names by default and exposes them only with privacy off', async () => {
    mocks.list.mockResolvedValue({
      items: [{ id, number: 2, title: '成本 100' }],
      nextCursor: null,
    });
    expect((await listAssistantConversations(request, {})).items[0]).toEqual({
      id,
      number: 2,
      title: null,
    });
    const visible = new NextRequest(request.url, { headers: { 'x-assistant-privacy': 'off' } });
    expect((await listAssistantConversations(visible, {})).items[0].title).toBe('成本 100');
    expect(mocks.list).toHaveBeenCalledWith('authenticated-owner', undefined);
  });
  it('does not rename or delete without authentication', async () => {
    mocks.requireAccount.mockRejectedValue(new Error('UNAUTHORIZED'));
    await expect(
      renameAssistantConversation(request, { conversationId: id, title: '采购' }),
    ).rejects.toThrow('UNAUTHORIZED');
    await expect(deleteAssistantConversation(request, { conversationId: id })).rejects.toThrow(
      'UNAUTHORIZED',
    );
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('uses only authenticated identity for create/read/cancel', async () => {
    await createAssistantConversation(request);
    expect(mocks.create).toHaveBeenCalledWith('authenticated-owner');
    await readAssistantConversation(request, { conversationId: id });
    expect(mocks.read).toHaveBeenCalledWith('authenticated-owner', id);
    await commandAssistantConversation(request, {
      action: 'cancel',
      conversationId: id,
      revision: 2,
    });
    expect(mocks.cancel).toHaveBeenCalledWith('authenticated-owner', id, 2);
  });
  it('does not query or mutate storage on authentication failure', async () => {
    mocks.requireAccount.mockRejectedValue(new Error('UNAUTHORIZED'));
    await expect(createAssistantConversation(request)).rejects.toThrow('UNAUTHORIZED');
    await expect(
      commandAssistantConversation(request, { action: 'cancel', conversationId: id, revision: 2 }),
    ).rejects.toThrow('UNAUTHORIZED');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('rejects client identities/custom tools and stale revisions', async () => {
    await expect(
      commandAssistantConversation(request, {
        action: 'cancel',
        conversationId: id,
        revision: 2,
        accountId: 'other',
      }),
    ).rejects.toThrow();
    await expect(
      commandAssistantConversation(request, {
        action: 'message',
        conversationId: id,
        revision: 2,
        text: 'x',
        tools: [],
      }),
    ).rejects.toThrow();
    mocks.read.mockResolvedValue({ session: { revision: 3 }, latest: null });
    await expect(
      commandAssistantConversation(request, {
        action: 'message',
        conversationId: id,
        revision: 2,
        text: 'x',
      }),
    ).rejects.toThrow('STALE_REVISION');
    expect(mocks.begin).not.toHaveBeenCalled();
  });
});
