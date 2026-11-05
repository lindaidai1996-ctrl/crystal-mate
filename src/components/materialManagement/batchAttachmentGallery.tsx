'use client';

import { AttachmentGallery } from '@/components/imageUpload/attachmentGallery';
import { apiFetch } from '@/lib/client-api';
import type { MaterialBatch } from '@/lib/client-types';

export function BatchAttachmentGallery({
  batch,
  onSaved,
  onUploadingChange,
}: {
  batch: MaterialBatch;
  onSaved: (batch: MaterialBatch) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  return (
    <AttachmentGallery
      owner={{ type: 'batch', id: batch.id }}
      attachments={batch.attachments ?? []}
      onUploadingChange={onUploadingChange}
      onSave={async (update) => {
        // Apply only this operation to freshly loaded attachments and metadata.
        const current = await apiFetch<MaterialBatch>(`/api/material-batches/${batch.id}`);
        const next = update({ ...current, attachments: current.attachments ?? [] });
        const saved = await apiFetch<MaterialBatch>(`/api/material-batches/${batch.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: current.name,
            receivedAt: current.receivedAt.slice(0, 10),
            notes: current.notes,
            coverObjectKey: next.coverObjectKey,
            attachments: next.attachments.map(({ objectKey, fileName, notes, source }) => ({
              objectKey,
              fileName,
              notes,
              source,
            })),
          }),
        });
        onSaved(saved);
      }}
    />
  );
}
