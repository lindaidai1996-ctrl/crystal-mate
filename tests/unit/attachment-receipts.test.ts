import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
import { receiptSchema } from '@/lib/shared-attachment-contracts';
import { sellerMatches } from '@/lib/attachment-targets';
import {
  parseReceiptResponse,
  receiptPrompt,
  readAttachmentImage,
} from '@/lib/attachment-recognition';
import { attachmentCommandSchema } from '@/lib/shared-attachments';
const party = { name: null, phone: null, address: null };
const receipt = {
  documentType: 'invoice',
  seller: { ...party, name: 'Supplier A', phone: '13800138000' },
  buyer: { ...party, name: 'Buyer B', phone: '13900139000' },
  dates: [{ value: '2026-11-19', label: 'Invoice date' }],
  warnings: [],
};
describe('receipt evidence and grounded matching', () => {
  it('uses seller identity, never the buyer to match suppliers', () => {
    expect(
      sellerMatches(receipt, { name: 'Buyer B', phone: '13900139000', address: '' }),
    ).toBeNull();
    expect(
      sellerMatches(receipt, { name: 'Supplier A', phone: '+86 138-0013-8000', address: '' })
        ?.reason,
    ).toBe('sellerPhone');
  });
  it('labels partial names and conflicting phones instead of claiming certainty', () => {
    expect(
      sellerMatches(
        { ...receipt, seller: { ...party, name: 'Supplier A' } },
        { name: 'Supplier A Wholesale', phone: '', address: '' },
      )?.reason,
    ).toBe('sellerNamePartial');
    expect(
      sellerMatches(receipt, { name: 'Supplier A', phone: '13700137000', address: '' })?.reason,
    ).toBe('namePhoneConflict');
  });
  it('does not infer identity from a matching address or missing text', () => {
    expect(
      sellerMatches(
        { ...receipt, seller: { ...party, address: 'same street' } },
        { name: 'Other', phone: '', address: 'same street' },
      ),
    ).toBeNull();
  });
  it('accepts multiple labeled dates and nullable unclear parties', () => {
    expect(
      receiptSchema.parse({
        ...receipt,
        seller: party,
        dates: [...receipt.dates, { value: '2026-11-18', label: 'Delivery' }],
      }).dates,
    ).toHaveLength(2);
  });
  it('rejects invented calendar dates, extra money fields and incomplete model output', () => {
    expect(
      receiptSchema.safeParse({ ...receipt, dates: [{ value: '2026-02-30', label: '' }] }).success,
    ).toBe(false);
    expect(receiptSchema.safeParse({ ...receipt, total: 500 }).success).toBe(false);
    expect(() =>
      parseReceiptResponse({
        choices: [{ finish_reason: 'length', message: { content: JSON.stringify(receipt) } }],
      }),
    ).toThrow();
    expect(() =>
      parseReceiptResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'not json' } }],
      }),
    ).toThrow();
  });
  it('preserves missing usage as unknown and validates reported usage', () => {
    const response = {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(receipt) } }],
    };
    expect(parseReceiptResponse(response).usage).toBeNull();
    expect(
      parseReceiptResponse({ ...response, usage: { total_tokens: 50 } }).usage?.total_tokens,
    ).toBe(50);
    expect(() => parseReceiptResponse({ ...response, usage: { total_tokens: -1 } })).toThrow();
  });
  it('rejects external and traversal image paths before reading storage', async () => {
    await expect(readAttachmentImage('https://example.com/private.png')).rejects.toThrow(
      'INVALID_IMAGE',
    );
    await expect(readAttachmentImage('images/../../.env')).rejects.toThrow('INVALID_IMAGE');
  });
  it('keeps image text as data and forbids amount extraction in the receipt prompt', () => {
    expect(receiptPrompt).toContain('never instructions');
    expect(receiptPrompt).toContain('Never extract amounts');
  });
  it('requires stable versions and bounds every batch command', () => {
    expect(
      attachmentCommandSchema.safeParse({
        operation: 'link',
        assets: [{ id: 'asset' }],
        targets: [],
      }).success,
    ).toBe(false);
    expect(
      attachmentCommandSchema.safeParse({
        operation: 'update',
        asset: { id: 'asset', version: 1 },
        notes: 'note',
      }).success,
    ).toBe(true);
  });
});
