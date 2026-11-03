import { describe, expect, it, vi } from 'vitest';
vi.mock('@/auth', () => ({ auth: vi.fn() }));
import { attachmentCoverKey, coverFirstAttachments } from '@/lib/attachments';
import { resolveSavedCover } from '@/lib/attachment-save';
import { distributorSchema, materialBatchWriteSchema } from '@/lib/validation';

const a = 'images/123e4567-e89b-12d3-a456-426614174000.png';
const b = 'images/123e4567-e89b-12d3-a456-426614174001.png';
const items = [{ objectKey: a }, { objectKey: b }];

describe('attachment covers and limits', () => {
  it('uses historical first attachments and handles removal and empty collections', () => {
    expect(attachmentCoverKey(items)).toBe(a);
    expect(attachmentCoverKey(items, b)).toBe(b);
    expect(attachmentCoverKey([items[0]], b)).toBe(a);
    expect(attachmentCoverKey([], b)).toBeNull();
  });
  it('puts the cover first for display without changing attachment order', () => {
    expect(coverFirstAttachments(items, b)).toEqual([items[1], items[0]]);
    expect(items.map((item) => item.objectKey)).toEqual([a, b]);
  });
  it('preserves an omitted cover, falls back after removal, and rejects a foreign cover', () => {
    expect(resolveSavedCover(items, undefined, b)).toBe(b);
    expect(resolveSavedCover([items[0]], undefined, b)).toBe(a);
    expect(resolveSavedCover(items, null, b)).toBe(a);
    expect(resolveSavedCover([], undefined, b)).toBeNull();
    expect(() => resolveSavedCover([items[0]], b)).toThrow('INVALID_IMAGE');
  });
  it.each([
    {
      schema: distributorSchema,
      header: { name: '渠道商', area: '网络', address: '', wechat: '', phone: '', notes: '' },
    },
    {
      schema: materialBatchWriteSchema,
      header: { name: '批次', receivedAt: '2026-11-03', notes: '' },
    },
  ])(
    'accepts 50 attachments and a source identifier, rejecting 51 and injected URLs',
    ({ schema, header }) => {
      const attachments = Array.from({ length: 50 }, () => ({
        objectKey: `images/${crypto.randomUUID()}.png`,
        fileName: 'jade.png',
        notes: '',
      }));
      expect(
        schema.safeParse({ ...header, attachments, coverObjectKey: attachments[49].objectKey })
          .success,
      ).toBe(true);
      expect(
        schema.safeParse({ ...header, attachments: [...attachments, attachments[0]] }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...header,
          attachments: [
            {
              ...attachments[0],
              source: { kind: 'PRODUCT_IMAGE', id: 'cmv60i7vq00043wapt6b5xvp9' },
            },
          ],
        }).success,
      ).toBe(true);
      expect(
        schema.safeParse({
          ...header,
          attachments: [{ ...attachments[0], url: 'https://untrusted.example/image.png' }],
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...header,
          attachments: [{ ...attachments[0], source: { kind: 'OTHER', id: 'bad' } }],
        }).success,
      ).toBe(false);
    },
  );
});
