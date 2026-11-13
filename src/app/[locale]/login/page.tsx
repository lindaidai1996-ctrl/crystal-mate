import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { SiteRegistrationFooter } from '@/components/site-registration-footer';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await auth()) redirect(`/${locale}/admin/products`);
  return (
    <div className="login-layout">
      <LoginForm />
      <SiteRegistrationFooter />
    </div>
  );
}
