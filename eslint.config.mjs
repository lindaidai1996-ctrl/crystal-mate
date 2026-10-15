import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', '.next-e2e/**', '.next-e2e-product-sources/**', 'node_modules/**'] },
];
export default config;
