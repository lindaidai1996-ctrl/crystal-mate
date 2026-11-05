export function adminReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/admin/') || /[\\#]/.test(value)) return undefined;
  try {
    return new URL(value, 'http://localhost').pathname.startsWith('/admin/') ? value : undefined;
  } catch {
    return undefined;
  }
}

export function withAdminReturnTo(path: string, returnTo: string): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('returnTo', returnTo);
  return `${pathname}?${params}`;
}
