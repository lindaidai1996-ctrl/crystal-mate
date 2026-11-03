import { z } from 'zod';

export type DateRange = [string, string] | null;

// The admin date-time filters use Beijing wall time, independent of browser/server timezone.
const minute = z.iso
  .datetime({ local: true, precision: -1 })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
export const createdTimeFilterFields = {
  createdFrom: minute.optional(),
  createdTo: minute.optional(),
};

type CreatedTimeFilter = { createdFrom?: string; createdTo?: string };

export function validCreatedTimeRange({ createdFrom, createdTo }: CreatedTimeFilter) {
  return !createdFrom || !createdTo || createdFrom <= createdTo;
}

export function createdTimeWhere({ createdFrom, createdTo }: CreatedTimeFilter) {
  if (!createdFrom && !createdTo) return {};
  return {
    createdAt: {
      ...(createdFrom ? { gte: new Date(`${createdFrom}:00+08:00`) } : {}),
      // Include every second of the selected end minute using an exclusive upper bound.
      ...(createdTo ? { lt: new Date(new Date(`${createdTo}:00+08:00`).getTime() + 60_000) } : {}),
    },
  };
}

export function inDateRange(value: string, range: DateRange) {
  // Batch receivedAt is stored as a date at UTC midnight, not a local timestamp.
  const date = value.slice(0, 10);
  return !range || (date >= range[0] && date <= range[1]);
}
