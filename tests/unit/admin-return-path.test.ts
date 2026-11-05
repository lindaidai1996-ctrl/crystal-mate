import { describe, expect, it } from 'vitest';
import { adminReturnPath, withAdminReturnTo } from '../../src/lib/admin-return-path';

describe('admin return paths', () => {
  it('preserves a nested detail origin', () => {
    const batch = withAdminReturnTo('/admin/materials/batches/b1', '/admin/materials');
    const editor = withAdminReturnTo('/admin/products/p1', batch);
    expect(
      adminReturnPath(new URL(editor, 'https://example.test').searchParams.get('returnTo')),
    ).toBe(batch);
  });

  it('keeps existing edit parameters while adding the return path', () => {
    const url = withAdminReturnTo('/admin/products/new?draftId=d1', '/admin/catalog/cabochons');
    const params = new URL(url, 'https://example.test').searchParams;
    expect(params.get('draftId')).toBe('d1');
    expect(params.get('returnTo')).toBe('/admin/catalog/cabochons');
  });

  it.each([
    'https://example.test/admin/products',
    '//example.test',
    '/login',
    '/admin/../login',
    '/admin/x#bad',
    '/admin/\\evil',
  ])('rejects unsafe or non-admin return paths', (path) =>
    expect(adminReturnPath(path)).toBeUndefined(),
  );
});
