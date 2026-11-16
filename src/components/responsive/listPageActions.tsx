import type { ReactNode } from 'react';
import mobileStyles from './responsive.module.css';

export function ListPageActions({
  primary,
  children,
}: {
  primary: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={mobileStyles.pageActions}>
      {children && <div className={mobileStyles.secondaryActions}>{children}</div>}
      <div className={mobileStyles.primaryAction}>{primary}</div>
    </div>
  );
}
