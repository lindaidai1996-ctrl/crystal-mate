import type { ReactNode } from 'react';
import mobileStyles from './responsive.module.css';

export function SearchFilterRow({ children }: { children: ReactNode }) {
  return <div className={mobileStyles.searchRow}>{children}</div>;
}
