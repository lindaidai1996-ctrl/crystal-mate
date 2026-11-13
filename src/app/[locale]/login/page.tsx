import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { SiteRegistrationFooter } from '@/components/site-registration-footer';
import loginStyles from '@/components/loginForm.module.css';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await auth()) redirect(`/${locale}/admin/products`);
  return (
    <div className={loginStyles.layout}>
      <LoginForm />
      <SiteRegistrationFooter />
    </div>
  );
}
