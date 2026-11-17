import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assistantFeedbackSchema } from '@/lib/ai-assistant/feedback-contracts';
import { validateAssistantFeedbackTarget } from '@/lib/ai-assistant/feedback-target';
import type { Prisma } from '@prisma/client';

const base = {
  requestId: '43c907af-6a47-4da3-9357-6aa87bb74687',
  conversationId: 'dd3d0c19-9499-47cd-8e83-bef7e86b83ee',
  executionId: '55baec7b-8de6-46c7-abcf-4b907ce72dde',
};
it('requires a target for inclusion/exclusion and an explanation for misunderstanding', () => {
  expect(assistantFeedbackSchema.safeParse({ ...base, kind: 'should_include' }).success).toBe(
    false,
  );
  expect(assistantFeedbackSchema.safeParse({ ...base, kind: 'does_not_belong' }).success).toBe(
    false,
  );
  expect(
    assistantFeedbackSchema.safeParse({ ...base, kind: 'misunderstood', note: '' }).success,
  ).toBe(false);
  expect(
    assistantFeedbackSchema.safeParse({ ...base, kind: 'misunderstood', note: 'wrong scope' })
      .success,
  ).toBe(true);
});
it('rejects client owners/global-rule changes and mismatched purchase identities', () => {
  for (const field of ['ownerId', 'accountId', 'ruleVersion', 'updateGlobalRule', 'status'])
    expect(
      assistantFeedbackSchema.safeParse({
        ...base,
        kind: 'misunderstood',
        note: 'x',
        [field]: 'forged',
      }).success,
    ).toBe(false);
  expect(
    assistantFeedbackSchema.safeParse({
      ...base,
      kind: 'should_include',
      target: {
        item: { type: 'PRODUCT', id: `c${'1'.repeat(24)}` },
        purchase: { type: 'MATERIAL_PURCHASE', id: `c${'2'.repeat(24)}` },
      },
    }).success,
  ).toBe(false);
});
it('rejects a purchase belonging to a different catalog item using only minimal fields', async () => {
  const findUnique = vi.fn().mockResolvedValue({ id: `c${'1'.repeat(24)}` });
  const findFirst = vi.fn().mockResolvedValue(null);
  const tx = {
    material: { findUnique },
    materialBatchEntry: { findFirst },
  } as unknown as Prisma.TransactionClient;
  await expect(
    validateAssistantFeedbackTarget(tx, {
      item: { type: 'MATERIAL', id: `c${'1'.repeat(24)}` },
      purchase: { type: 'MATERIAL_PURCHASE', id: `c${'2'.repeat(24)}` },
    }),
  ).rejects.toThrow('FEEDBACK_REFERENCE_INVALID');
  expect(findFirst).toHaveBeenCalledWith({
    where: { id: `c${'2'.repeat(24)}`, materialId: `c${'1'.repeat(24)}` },
    select: { id: true },
  });
});
const account = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ requireAccount: account }));
vi.mock('@/lib/db', () => ({ db: {} }));
import { saveAssistantConversationFeedback } from '@/lib/ai-assistant/conversation-service';
it('authenticates feedback before validation or business/storage access', async () => {
  account.mockRejectedValue(new Error('UNAUTHORIZED'));
  await expect(
    saveAssistantConversationFeedback(
      new NextRequest('http://localhost/api/assistant/feedback', { method: 'POST' }),
      { bad: true },
    ),
  ).rejects.toThrow('UNAUTHORIZED');
});
