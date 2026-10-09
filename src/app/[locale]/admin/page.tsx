import { redirect } from 'next/navigation';

export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  redirect(`/${(await params).locale}/admin/products`);
}
