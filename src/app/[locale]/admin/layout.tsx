import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin-shell';
import { SiteRegistrationFooter } from '@/components/site-registration-footer';
import { db } from '@/lib/db';
import { profileSelect } from '@/lib/account';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.name) redirect(`/${locale}/login`);
  const account = await db.admin.findUnique({
    where: { username: session.user.name },
    select: profileSelect,
  });
  if (!account) redirect(`/${locale}/login`);
  return (
    <AdminShell account={account} footer={<SiteRegistrationFooter />}>
      {children}
    </AdminShell>
  );
}
