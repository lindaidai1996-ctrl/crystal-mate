import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { encode as encodeJwt } from 'next-auth/jwt';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';

const SHORT_SESSION_AGE = 60 * 60 * 12;
const REMEMBERED_SESSION_AGE = 60 * 60 * 24 * 7;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The cookie itself can live for seven days; the JWT expiry below keeps an
  // unchecked sign-in at the shorter session duration.
  session: { strategy: 'jwt', maxAge: REMEMBERED_SESSION_AGE },
  jwt: {
    async encode(params) {
      const remember = params.token?.remember === true;
      return encodeJwt({
        ...params,
        maxAge: remember ? REMEMBERED_SESSION_AGE : SHORT_SESSION_AGE,
      });
    },
  },
  pages: { signIn: '/zh/login' },
  callbacks: {
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.user.name =
        typeof token.actorUsername === 'string' ? token.actorUsername : session.user.name;
      session.user.nickname = typeof token.actorNickname === 'string' ? token.actorNickname : '';
      return session;
    },
    async jwt({ token, user }) {
      if (user && 'sessionVersion' in user) token.sessionVersion = user.sessionVersion;
      if (user && 'remember' in user) token.remember = user.remember;
      if (!token.sub) return null;
      const admin = await db.admin.findUnique({
        where: { id: token.sub },
        select: { sessionVersion: true, username: true, nickname: true },
      });
      // Tokens issued before account settings were introduced belong to version 0.
      if (!admin || (token.sessionVersion ?? 0) !== admin.sessionVersion) return null;
      if (typeof admin.username === 'string') token.actorUsername = admin.username;
      if (typeof admin.nickname === 'string') token.actorNickname = admin.nickname;
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: { username: {}, password: {}, remember: {} },
      async authorize(raw) {
        const parsed = z
          .object({
            username: z.string().trim().min(1),
            password: z.string().min(1),
            remember: z.enum(['true', 'false']).optional(),
          })
          .safeParse(raw);
        if (!parsed.success) return null;
        const admin = await db.admin.findUnique({
          where: { username: parsed.data.username.toLowerCase() },
        });
        if (!admin || !(await compare(parsed.data.password, admin.passwordHash))) return null;
        return {
          id: admin.id,
          name: admin.username,
          sessionVersion: admin.sessionVersion,
          remember: parsed.data.remember === 'true',
        };
      },
    }),
  ],
});
