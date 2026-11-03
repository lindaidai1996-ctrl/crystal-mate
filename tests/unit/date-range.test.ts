import { describe, expect, it } from 'vitest';
import { createdTimeWhere, inDateRange } from '../../src/lib/date-range';
import { listSchema, materialListSchema } from '../../src/lib/validation';

describe('creation time filters', () => {
  it.each([listSchema, materialListSchema])(
    'accepts minute ranges, including a single minute, and rejects invalid or reversed values',
    (schema) => {
      expect(
        schema.parse({ createdFrom: '2026-10-27T09:30', createdTo: '2026-10-27T09:30' }),
      ).toMatchObject({ createdFrom: '2026-10-27T09:30', createdTo: '2026-10-27T09:30' });
      for (const createdFrom of [
        '2026-02-30T10:00',
        '2026-10-27',
        '2026-10-27T24:00',
        '2026-10-27T10:60',
        '2026-10-27T09:30:00',
        '2026-10-27T09:30Z',
      ]) {
        expect(schema.safeParse({ createdFrom }).success).toBe(false);
      }
      expect(
        schema.safeParse({ createdFrom: '2026-10-28T00:00', createdTo: '2026-10-27T23:59' })
          .success,
      ).toBe(false);
      expect(schema.safeParse({ createdFrom: '2028-02-29T23:59' }).success).toBe(true);
    },
  );

  it('uses Beijing time and includes the entire end minute across midnight', () => {
    const { createdAt } = createdTimeWhere({
      createdFrom: '2026-10-27T23:59',
      createdTo: '2026-10-27T23:59',
    });
    expect(createdAt?.gte?.toISOString()).toBe('2026-10-27T15:59:00.000Z');
    expect(createdAt?.lt?.toISOString()).toBe('2026-10-27T16:00:00.000Z');
    const included = (value: string) =>
      new Date(value) >= createdAt!.gte! && new Date(value) < createdAt!.lt!;
    expect(included('2026-10-27T15:58:59.999Z')).toBe(false);
    expect(included('2026-10-27T15:59:00.000Z')).toBe(true);
    expect(included('2026-10-27T15:59:59.999Z')).toBe(true);
    expect(included('2026-10-27T16:00:00.000Z')).toBe(false);
  });

  it('does not add a time condition when cleared and supports individual bounds', () => {
    expect(createdTimeWhere({})).toEqual({});
    expect(createdTimeWhere({ createdFrom: '2026-10-27T00:00' })).toEqual({
      createdAt: { gte: new Date('2026-10-26T16:00:00Z') },
    });
    expect(createdTimeWhere({ createdTo: '2026-12-31T23:59' })).toEqual({
      createdAt: { lt: new Date('2026-12-31T16:00:00Z') },
    });
  });
});

describe('batch arrival date filters', () => {
  it('includes both end dates without shifting stored calendar dates', () => {
    const range: [string, string] = ['2026-10-26', '2026-10-27'];
    expect(inDateRange('2026-10-25T00:00:00.000Z', range)).toBe(false);
    expect(inDateRange('2026-10-26T00:00:00.000Z', range)).toBe(true);
    expect(inDateRange('2026-10-27T00:00:00.000Z', range)).toBe(true);
    expect(inDateRange('2026-10-28T00:00:00.000Z', range)).toBe(false);
    expect(inDateRange('2026-10-27T00:00:00.000Z', ['2026-10-27', '2026-10-27'])).toBe(true);
    expect(inDateRange('2026-10-25T00:00:00.000Z', null)).toBe(true);
  });
});
