'use client';

import { AttachmentGallery } from '@/components/imageUpload/attachmentGallery';
import { apiFetch } from '@/lib/client-api';
import type { Distributor, DistributorDetailResponse } from '@/lib/client-types';

export function DistributorAttachmentGallery({
  distributor,
  onSaved,
  onUploadingChange,
}: {
  distributor: Distributor;
  onSaved: (distributor: Distributor) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  return (
    <AttachmentGallery
      owner={{ type: 'distributor', id: distributor.id }}
      attachments={distributor.attachments}
      onUploadingChange={onUploadingChange}
      onSave={async (update) => {
        const { item: current } = await apiFetch<DistributorDetailResponse>(
          `/api/distributors/${distributor.id}`,
        );
        const next = update(current);
        const saved = await apiFetch<Distributor>(`/api/distributors/${distributor.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: current.name,
            area: current.area,
            address: current.address,
            wechat: current.wechat,
            phone: current.phone,
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
