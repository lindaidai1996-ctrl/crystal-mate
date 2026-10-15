import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.E2E_DIST_DIR ?? '.next',
  serverExternalPackages: ['@prisma/client', 'cos-nodejs-sdk-v5'],
});
