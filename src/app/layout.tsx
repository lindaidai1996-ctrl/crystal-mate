import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import './globals.css';

export const metadata: Metadata = {
  title: '祝余水晶',
  description: 'Crystal Mate catalog manager',
  icons: { icon: '/images/logo.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="crystal-mate">
        <AntdRegistry layer>{children}</AntdRegistry>
      </body>
    </html>
  );
}
