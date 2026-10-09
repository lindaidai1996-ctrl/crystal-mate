import 'dotenv/config';
import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!username || !password) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD before running this command.');
  process.exit(1);
}

async function main() {
  const db = new PrismaClient();
  try {
    const admins = await db.admin.findMany({ select: { id: true }, take: 2 });
    if (admins.length > 1)
      throw new Error('Multiple admins exist. Refusing to choose an account to update.');
    const data = { username: username!, passwordHash: await hash(password!, 12) };
    if (admins.length === 1) {
      await db.admin.update({ where: { id: admins[0].id }, data });
      console.log(`Admin updated: ${username}`);
    } else {
      await db.admin.create({ data });
      console.log(`Admin created: ${username}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
