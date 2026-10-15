import { describe, expect, it } from 'vitest';
import { distributorAreaSchema, distributorSchema } from '../../src/lib/validation';

const validDistributor = {
  name: '东海渠道商',
  area: '东海',
  address: '',
  wechat: '',
  phone: '',
  notes: '',
};

describe('distributor validation', () => {
  it('requires a name and area and trims manual areas', () => {
    expect(distributorSchema.parse({ ...validDistributor, area: '  新归属地  ' }).area).toBe(
      '新归属地',
    );
    expect(distributorSchema.safeParse({ ...validDistributor, name: '  ' }).success).toBe(false);
    expect(distributorSchema.safeParse({ ...validDistributor, area: '  ' }).success).toBe(false);
  });

  it('accepts optional contact details and enforces field limits', () => {
    expect(
      distributorSchema.parse({
        ...validDistributor,
        address: '东海县',
        wechat: 'contact_01',
        phone: '13800138000',
        notes: '线下合作',
      }).phone,
    ).toBe('13800138000');
    expect(distributorSchema.safeParse({ ...validDistributor, area: 'a'.repeat(61) }).success).toBe(
      false,
    );
    expect(
      distributorSchema.safeParse({ ...validDistributor, phone: '1'.repeat(51) }).success,
    ).toBe(false);
    expect(distributorSchema.safeParse({ ...validDistributor, unexpected: true }).success).toBe(
      false,
    );
  });

  it('accepts up to 12 image attachments with names and notes', () => {
    const attachment = {
      objectKey: 'images/123e4567-e89b-12d3-a456-426614174000.png',
      fileName: '采购凭证.png',
      notes: '已核对',
    };
    expect(
      distributorSchema.parse({ ...validDistributor, attachments: [attachment] }).attachments,
    ).toEqual([attachment]);
    expect(
      distributorSchema.safeParse({ ...validDistributor, attachments: Array(13).fill(attachment) })
        .success,
    ).toBe(false);
    expect(
      distributorSchema.safeParse({
        ...validDistributor,
        attachments: [{ ...attachment, objectKey: 'documents/receipt.pdf' }],
      }).success,
    ).toBe(false);
    expect(
      distributorSchema.safeParse({
        ...validDistributor,
        attachments: [{ ...attachment, notes: 'a'.repeat(1001) }],
      }).success,
    ).toBe(false);
  });
});

describe('distributor area validation', () => {
  it('trims names and rejects blank or oversized names', () => {
    expect(distributorAreaSchema.parse({ name: '  新归属地  ' })).toEqual({ name: '新归属地' });
    expect(distributorAreaSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(distributorAreaSchema.safeParse({ name: 'a'.repeat(61) }).success).toBe(false);
  });
});
