import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createGrant: vi.fn(),
  mode: vi.fn(),
  sign: vi.fn(),
  head: vi.fn(),
  stream: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { uploadGrant: { create: mocks.createGrant } } }));
vi.mock('@/lib/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/media')>()),
  storageMode: mocks.mode,
  cosConfig: () => ({
    bucket: 'fixture-bucket',
    region: 'fixture-region',
    client: {
      getObjectUrl: mocks.sign,
      headObject: mocks.head,
      getObjectStream: mocks.stream,
      getObject: mocks.get,
    },
  }),
}));

import { POST } from '@/app/api/uploads/route';
import { GET } from '@/app/api/images/[...path]/route';
import { readImportSource } from '@/lib/materialImageImport/sourceImage';
import { createImportSchema, commitImportSchema } from '@/lib/materialImageImport/contracts';
import { materialBatchWriteSchema } from '@/lib/validation';
import { imageThumbnailUrl } from '@/lib/image-storage';

const name = '123e4567-e89b-42d3-a456-426614174000.png';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const cases = [
  { purpose: undefined, prefix: 'images' },
  { purpose: 'import-source', prefix: 'material-imports/sources' },
  { purpose: 'import-crop', prefix: 'material-imports/crops' },
  { purpose: 'cabochon', prefix: 'cabochons/images' },
  { purpose: 'cabochon-excel', prefix: 'cabochons/images' },
] as const;

let cacheDirectory: string;
beforeEach(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), 'crystal-image-api-'));
  vi.stubEnv('MEDIA_CACHE_DIR', cacheDirectory);
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.mode.mockReturnValue('cos');
  mocks.createGrant.mockResolvedValue({ id: 'grant' });
  mocks.sign.mockReturnValue('https://cos.example/signed');
  mocks.head.mockResolvedValue({ headers: { 'content-length': String(png.length) } });
  mocks.stream.mockImplementation(() => Readable.from([png]));
  mocks.get.mockResolvedValue({ Body: png });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(cacheDirectory, { recursive: true, force: true });
});

describe('image storage routing', () => {
  const read = (headers?: HeadersInit, query = '') =>
    GET(new NextRequest(`http://localhost/api/images/${name}${query}`, { headers }), {
      params: Promise.resolve({ path: [name] }),
    });

  it('serves repeated reads and 304 validation from disk without querying COS', async () => {
    const first = await read();
    expect(first.headers.get('cache-control')).toBe('private, max-age=2592000, immutable');
    const etag = first.headers.get('etag')!;
    expect(Buffer.from(await first.arrayBuffer())).toEqual(png);
    const second = await read();
    expect(Buffer.from(await second.arrayBuffer())).toEqual(png);
    const unchanged = await read({ 'If-None-Match': `"another-image", W/${etag}` });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    expect(unchanged.headers.get('content-length')).toBeNull();
    expect((await read({ 'If-None-Match': '"other"' })).status).toBe(200);
    expect(mocks.head).toHaveBeenCalledTimes(1);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it('checks authentication even for cached images and matching ETags', async () => {
    const first = await read();
    mocks.auth.mockResolvedValue(null);
    expect((await read({ 'If-None-Match': first.headers.get('etag')! })).status).toBe(401);
    expect((await read(undefined, '?w=128')).status).toBe(401);
    expect(mocks.head).toHaveBeenCalledTimes(1);
  });

  it('generates uncropped thumbnails and reuses the original for every rendition', async () => {
    const original = await sharp({
      create: { width: 1200, height: 600, channels: 4, background: '#aaccee' },
    })
      .png()
      .toBuffer();
    mocks.head.mockResolvedValue({ headers: { 'content-length': String(original.length) } });
    mocks.stream.mockImplementation(() => Readable.from([original]));
    const small = await read(undefined, '?w=128');
    const smallBytes = Buffer.from(await small.arrayBuffer());
    expect(small.headers.get('content-type')).toBe('image/webp');
    expect(await sharp(smallBytes).metadata()).toMatchObject({ width: 128, height: 64 });
    const large = await read(undefined, '?w=640');
    expect(await sharp(Buffer.from(await large.arrayBuffer())).metadata()).toMatchObject({
      width: 640,
      height: 320,
    });
    expect(large.headers.get('etag')).not.toBe(small.headers.get('etag'));
    expect((await read({ 'If-None-Match': small.headers.get('etag')! }, '?w=128')).status).toBe(
      304,
    );
    expect(Buffer.from(await (await read()).arrayBuffer())).toEqual(original);
    expect(mocks.head).toHaveBeenCalledTimes(1);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported sizes before querying storage', async () => {
    for (const query of ['?w=999', '?w=0', '?w=', '?w=../secret'])
      expect((await read(undefined, query)).status).toBe(400);
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it('falls back to the cached original when thumbnail conversion is unavailable', async () => {
    // The tiny signature-only fixture cannot be decoded by sharp.
    const response = await read(undefined, '?w=128');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect((await read(undefined, '?w=128')).status).toBe(200);
    expect(mocks.head).toHaveBeenCalledTimes(1);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it('does not cache missing objects or truncated downloads', async () => {
    mocks.head.mockRejectedValueOnce({ statusCode: 404 });
    expect((await read()).status).toBe(404);
    mocks.stream.mockImplementationOnce(() => Readable.from([png.subarray(0, 2)]));
    expect((await read()).status).toBe(502);
    expect(Buffer.from(await (await read()).arrayBuffer())).toEqual(png);
    expect(mocks.head).toHaveBeenCalledTimes(3);
  });

  it('uses stable thumbnail URLs without altering external or temporary images', () => {
    expect(imageThumbnailUrl(`/api/images/${name}`)).toBe(`/api/images/${name}?w=128`);
    expect(imageThumbnailUrl(`/uploads/cabochons/images/${name}`, 640)).toBe(
      `/api/images/cabochons/images/${name}?w=640`,
    );
    for (const url of [
      'blob:temporary',
      'data:image/png;base64,AA',
      'https://cos.example/image.png',
      '/uploads/../secret',
    ])
      expect(imageThumbnailUrl(url)).toBe(url);
  });

  it.each(cases)('grants COS uploads under $prefix', async ({ purpose, prefix }) => {
    const response = await POST(
      new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/png', size: png.length, purpose }),
      }),
    );
    expect(response.status).toBe(200);
    const grant = await response.json();
    expect(grant.key).toMatch(new RegExp(`^${prefix}/[0-9a-f-]{36}\\.png$`));
    expect(grant.url).toBe(`/api/images/${prefix === 'images' ? grant.key.slice(7) : grant.key}`);
    expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({ Key: grant.key }));
    expect(mocks.createGrant).toHaveBeenCalledWith({
      data: expect.objectContaining({ objectKey: grant.key, url: grant.url }),
    });
  });

  it.each(cases)('uses the same $prefix layout for local uploads', async ({ purpose, prefix }) => {
    mocks.mode.mockReturnValue('local');
    const response = await POST(
      new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/png', size: png.length, purpose }),
      }),
    );
    const grant = await response.json();
    expect(grant.key.startsWith(`${prefix}/`)).toBe(true);
    expect(grant.url).toBe(`/uploads/${grant.key}`);
    expect(grant.uploadUrl).toBe('/api/uploads/local');
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each([...cases, { prefix: 'cabochon-imports/images' }])(
    'streams private $prefix images, preserving legacy URLs',
    async ({ prefix }) => {
      const path = prefix === 'images' ? [name] : [...prefix.split('/'), name];
      const response = await GET(new NextRequest('http://localhost/api/images/fixture'), {
        params: Promise.resolve({ path }),
      });
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toContain('private');
      expect(mocks.head).toHaveBeenCalledWith(
        expect.objectContaining({ Key: `${prefix}/${name}` }),
      );
    },
  );

  it('rejects arbitrary prefixes and traversal before contacting COS', async () => {
    for (const path of [
      ['private', 'sources', name],
      ['material-imports', 'other', name],
      ['material-imports', '..', name],
      ['material-imports/sources', name],
      ['material-imports', 'sources', '../secret.png'],
      ['material-imports', 'sources', 'not-an-image.txt'],
    ]) {
      expect(
        (
          await GET(new NextRequest('http://localhost/api/images/fixture'), {
            params: Promise.resolve({ path }),
          })
        ).status,
      ).toBe(404);
    }
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('requires authentication for both new upload grants and image reads', async () => {
    mocks.auth.mockResolvedValue(null);
    expect(
      (await POST(new NextRequest('http://localhost/api/uploads', { method: 'POST' }))).status,
    ).toBe(401);
    expect(
      (
        await GET(new NextRequest('http://localhost/api/images/fixture'), {
          params: Promise.resolve({ path: ['material-imports', 'crops', name] }),
        })
      ).status,
    ).toBe(401);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it('rejects client-supplied storage paths instead of accepting arbitrary prefixes', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/png', size: png.length, purpose: '../../private' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it.each(['images', 'material-imports/sources'])(
    'reads recognition originals from %s',
    async (prefix) => {
      expect(await readImportSource(`${prefix}/${name}`)).toEqual({
        bytes: png,
        mimeType: 'image/png',
      });
      expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ Key: `${prefix}/${name}` }));
    },
  );

  it('accepts original photos in batch edits while enforcing source and crop roles', async () => {
    const sourceKey = `material-imports/sources/${name}`;
    const cropKey = `material-imports/crops/${name}`;
    const source = {
      sourceKey,
      fileName: 'supplier.png',
      width: 100,
      height: 100,
      provider: 'deepseek',
      priceKind: 'PURCHASE',
    };
    const commit = { version: 0, itemId: crypto.randomUUID(), imageKey: cropKey };
    expect(createImportSchema.safeParse(source).success).toBe(true);
    expect(commitImportSchema.safeParse(commit).success).toBe(true);
    expect(createImportSchema.safeParse({ ...source, sourceKey: cropKey }).success).toBe(false);
    expect(commitImportSchema.safeParse({ ...commit, imageKey: sourceKey }).success).toBe(false);
    expect(createImportSchema.safeParse({ ...source, sourceKey: `images/${name}` }).success).toBe(
      true,
    );
    expect(commitImportSchema.safeParse({ ...commit, imageKey: `images/${name}` }).success).toBe(
      true,
    );
    expect(
      materialBatchWriteSchema.safeParse({
        name: '采购批次',
        receivedAt: '2026-10-21',
        notes: '',
        attachments: [{ objectKey: sourceKey, fileName: 'supplier.png', notes: '' }],
      }).success,
    ).toBe(true);
    await expect(readImportSource(cropKey)).rejects.toThrow('INVALID_IMAGE');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
