import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: { signIn: '/zh/login' },
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(raw) {
        const parsed = z
          .object({ username: z.string().trim().min(1), password: z.string().min(1) })
          .safeParse(raw);
        if (!parsed.success) return null;
        const admin = await db.admin.findUnique({
          where: { username: parsed.data.username.toLowerCase() },
        });
        if (!admin || !(await compare(parsed.data.password, admin.passwordHash))) return null;
        return { id: admin.id, name: admin.username };
      },
    }),
  ],
});
