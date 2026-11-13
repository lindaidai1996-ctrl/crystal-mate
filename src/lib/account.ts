import { z } from 'zod';
import { imageObjectKeyPattern } from './image-storage';

export const profileSelect = {
  username: true,
  nickname: true,
  avatarObjectKey: true,
  avatarUrl: true,
} as const;

export type AccountProfile = {
  username: string;
  nickname: string;
  avatarObjectKey: string | null;
  avatarUrl: string | null;
};

export const profileSchema = z
  .object({
    nickname: z.string().trim().min(1).max(40).optional(),
    avatarObjectKey: z.string().regex(imageObjectKeyPattern).nullable().optional(),
  })
  .strict()
  .refine((value) => value.nickname !== undefined || value.avatarObjectKey !== undefined);

// bcrypt only uses the first 72 bytes; reject longer input instead of silently truncating it.
export const newPasswordSchema = z
  .string()
  .min(8)
  .refine((value) => new TextEncoder().encode(value).length <= 72);

export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword);
