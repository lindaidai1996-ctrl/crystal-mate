import type { Prisma } from '@prisma/client';
import type { AssistantFeedbackInput } from './feedback-contracts';
import { CandidateQueryError } from './candidate-contracts';

// Validates existence and purchase/catalog identity only; no prices, contacts or arbitrary fields.
export async function validateAssistantFeedbackTarget(
  tx: Prisma.TransactionClient,
  target: AssistantFeedbackInput['target'],
) {
  if (!target) return;
  const item =
    target.item.type === 'MATERIAL'
      ? await tx.material.findUnique({ where: { id: target.item.id }, select: { id: true } })
      : await tx.product.findUnique({ where: { id: target.item.id }, select: { id: true } });
  if (!item) throw new CandidateQueryError('FEEDBACK_REFERENCE_INVALID');
  if (!target.purchase) return;
  const purchase =
    target.purchase.type === 'MATERIAL_PURCHASE'
      ? await tx.materialBatchEntry.findFirst({
          where: { id: target.purchase.id, materialId: item.id },
          select: { id: true },
        })
      : await tx.productPurchaseEntry.findFirst({
          where: { id: target.purchase.id, productId: item.id },
          select: { id: true },
        });
  if (!purchase) throw new CandidateQueryError('FEEDBACK_REFERENCE_INVALID');
}
