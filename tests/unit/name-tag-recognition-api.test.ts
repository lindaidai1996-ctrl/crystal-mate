import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findMany: vi.fn(), recognize: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { tag: { findMany: mocks.findMany } } }));
vi.mock('@/lib/ai/nameTagRecognition', () => ({ recognizeNameTags: mocks.recognize }));
import { POST } from '@/app/api/tags/recognize/route';

const request = (names: string[], origin = 'http://localhost:3000') =>
  new NextRequest('http://localhost:3000/api/tags/recognize', {
    method: 'POST',
    headers: { origin, host: 'localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.findMany.mockResolvedValue([{ id: 'tag-1', name: '云母' }]);
  mocks.recognize.mockResolvedValue([{ tagIds: ['tag-1'], missingTags: [] }]);
});
describe('name tag recognition API', () => {
  it('uses the server tag library and returns suggestions without writing catalog data', async () => {
    const pendingRequest = request([' 粉云母 ']);
    const response = await POST(pendingRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matches: [{ tagIds: ['tag-1'], missingTags: [] }] });
    expect(mocks.recognize).toHaveBeenCalledExactlyOnceWith(
      ['粉云母'],
      [{ id: 'tag-1', name: '云母' }],
      pendingRequest.signal,
    );
  });
  it('rejects unauthenticated and cross-origin requests before calling AI', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(request(['粉云母']))).status).toBe(401);
    expect((await POST(request(['粉云母'], 'https://other.example'))).status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
  });
  it('rejects oversized and empty batches before querying tags', async () => {
    for (const names of [[], [' '], Array(21).fill('粉云母')])
      expect((await POST(request(names))).status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
