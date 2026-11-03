import type { MaterialBatchAttachment } from './client-types';

export const MAX_ATTACHMENTS = 50;

export type AttachmentSource = {
  kind: 'MATERIAL_BATCH_IMAGE' | 'MATERIAL_IMAGE' | 'PRODUCT_IMAGE';
  id: string;
};

export type AttachmentOwner = { type: 'distributor' | 'batch'; id: string };

export type AttachmentCandidate = {
  itemId: string;
  type: 'MATERIAL' | 'PRODUCT';
  name: string;
  code: string | null;
  objectKey: string;
  url: string;
  fileName: string;
  source: AttachmentSource;
};

export type AttachmentCandidatePage = {
  items: AttachmentCandidate[];
  total: number;
  page: number;
  pageSize: number;
};

export function attachmentCoverKey(
  attachments: Pick<MaterialBatchAttachment, 'objectKey'>[],
  coverObjectKey?: string | null,
) {
  return (
    attachments.find((item) => item.objectKey === coverObjectKey)?.objectKey ??
    attachments[0]?.objectKey ??
    null
  );
}

export function coverFirstAttachments<T extends { objectKey: string }>(
  attachments: T[],
  coverObjectKey?: string | null,
): T[] {
  const key = attachmentCoverKey(attachments, coverObjectKey);
  return [
    ...attachments.filter((item) => item.objectKey === key),
    ...attachments.filter((item) => item.objectKey !== key),
  ];
}
