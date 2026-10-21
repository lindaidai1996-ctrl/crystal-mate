import { apiFetch } from '@/lib/client-api';
import { MAX_UPLOAD_BYTES } from './prepareImages';

type UploadGrant = {
  id: string;
  key: string;
  url: string;
  uploadUrl: string;
  mode: 'local' | 'cos';
};

export async function uploadImage(file: File) {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size < 1 ||
    file.size > MAX_UPLOAD_BYTES
  )
    throw new Error('INVALID_IMAGE');

  const grant = await apiFetch<UploadGrant>('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ type: file.type, size: file.size }),
  });
  if (grant.mode === 'local') {
    const body = new FormData();
    body.append('id', grant.id);
    body.append('file', file);
    await apiFetch(grant.uploadUrl, { method: 'POST', body });
  } else {
    const response = await fetch(grant.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!response.ok) throw new Error('UPLOAD_FAILED');
    await apiFetch('/api/uploads/confirm', {
      method: 'POST',
      body: JSON.stringify({ id: grant.id }),
    });
  }
  return { objectKey: grant.key, url: grant.url, position: 0 };
}
