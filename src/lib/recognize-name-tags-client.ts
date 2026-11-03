import { apiFetch } from '@/lib/client-api';
import type { NameTagMatch } from '@/lib/name-tag-matching';

export async function matchNameTags(names: string[], signal?: AbortSignal) {
  const result = await apiFetch<{ matches: NameTagMatch[] }>('/api/tags/recognize', {
    method: 'POST',
    body: JSON.stringify({ names }),
    signal,
  });
  return result.matches;
}
