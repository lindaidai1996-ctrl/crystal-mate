import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadImage } from '../../src/components/imageUpload/uploadImage';

afterEach(() => vi.unstubAllGlobals());

const file = new File(['pixels'], 'cropped.png', { type: 'image/png' });
const grant = {
  id: 'grant-1',
  key: 'images/replacement.png',
  url: '/api/images/replacement.png',
  uploadUrl: '/api/uploads/local',
  mode: 'local',
};

describe('shared image upload', () => {
  it('uploads local image bytes and returns replacement metadata', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(grant))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    expect(await uploadImage(file)).toEqual({
      objectKey: grant.key,
      url: grant.url,
      position: 0,
    });
    const body = fetch.mock.calls[1][1].body as FormData;
    expect(body.get('id')).toBe(grant.id);
    expect((body.get('file') as File).name).toBe(file.name);
  });

  it('confirms the grant only after COS accepted the uploaded image', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...grant, mode: 'cos', uploadUrl: 'https://cos.test/upload' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    await uploadImage(file);
    expect(fetch.mock.calls[1]).toEqual([
      'https://cos.test/upload',
      { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: file },
    ]);
    expect(fetch.mock.calls[2][0]).toBe('/api/uploads/confirm');
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ id: grant.id });
  });

  it('does not return replacement metadata or confirm a failed COS upload', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...grant, mode: 'cos' }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    await expect(uploadImage(file)).rejects.toThrow('UPLOAD_FAILED');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported, empty, and oversized images before requesting a grant', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const invalid of [
      new File(['pixels'], 'image.gif', { type: 'image/gif' }),
      new File([], 'empty.png', { type: 'image/png' }),
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    ]) {
      await expect(uploadImage(invalid)).rejects.toThrow('INVALID_IMAGE');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
