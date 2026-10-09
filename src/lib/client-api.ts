export class ClientApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ClientApiError(body.error ?? 'SERVER_ERROR');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
