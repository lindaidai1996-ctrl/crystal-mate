import type { ReactNode } from 'react';

// Retain each form's desktop grid; group short values into touch-friendly columns on phones.
export function CompactFields({
  children,
  columns = 2,
  className = '',
}: {
  children: ReactNode;
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <div className={`${className} mobile-numeric-grid`} data-columns={columns}>
      {children}
    </div>
  );
}
