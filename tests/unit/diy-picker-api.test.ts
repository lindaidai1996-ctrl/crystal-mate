import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ account: vi.fn(), materials: vi.fn(), cabochons: vi.fn() }));
vi.mock('@/lib/api', () => ({
  requireAccount: mocks.account,
  apiError: () => new Response('{}', { status: 400 }),
}));
vi.mock('@/lib/diy-picker/query', () => ({
  listPickerMaterials: mocks.materials,
  listPickerCabochons: mocks.cabochons,
}));
import { GET as getMaterials } from '@/app/api/diy-picker/materials/route';
import { GET as getCabochons } from '@/app/api/diy-picker/cabochons/route';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.mockResolvedValue({ id: 'authenticated-owner' });
  mocks.materials.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 24 });
  mocks.cabochons.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 24 });
});
describe('DIY picker authenticated API boundary', () => {
  it('ignores client ownership and returns a private noncached response', async () => {
    const response = await getMaterials(
      new NextRequest(
        'http://localhost/api/diy-picker/materials?source=recent&ownerId=someone-else',
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.materials).toHaveBeenCalledWith(
      'authenticated-owner',
      expect.objectContaining({ source: 'recent' }),
    );
    expect(mocks.materials.mock.calls[0][1]).not.toHaveProperty('ownerId');
  });
  it('does not read candidates before authentication succeeds', async () => {
    mocks.account.mockRejectedValue(new Error('unauthenticated'));
    await getCabochons(new NextRequest('http://localhost/api/diy-picker/cabochons'));
    expect(mocks.cabochons).not.toHaveBeenCalled();
  });
  it('rejects invalid dimensions and oversized pages before querying', async () => {
    for (const query of ['widthMin=10&widthMax=9', 'pageSize=100', 'page=0']) {
      const response = await getMaterials(
        new NextRequest(`http://localhost/api/diy-picker/materials?${query}`),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.materials).not.toHaveBeenCalled();
  });
});
