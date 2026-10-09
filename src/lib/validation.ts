import { z } from 'zod';

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const productSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(10000),
  categoryId: z.string().cuid(),
  priceCents: z.number().int().min(0).max(2147483647),
  currency: z.literal('CNY'),
  stock: z.union([z.literal(0), z.literal(1)]),
  published: z.boolean(),
  imageKeys: z
    .array(z.string().min(1))
    .max(12)
    .refine((keys) => new Set(keys).size === keys.length),
});

export const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().optional(),
  published: z.enum(['true', 'false']).optional(),
  stock: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
