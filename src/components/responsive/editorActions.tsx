'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import mobileStyles from './responsive.module.css';

export function EditorActions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(88);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.target.getBoundingClientRect().height),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className={mobileStyles.actionSpace}
      data-editor-actions
      style={{ '--editor-actions-height': `${height}px` } as CSSProperties}
    >
      <div ref={ref} className={`editor-actions ${mobileStyles.editorActions}`}>
        {children}
      </div>
    </div>
  );
}
