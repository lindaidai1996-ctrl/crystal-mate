'use client';

import { ArrowUpOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { usePathname } from '@/i18n/navigation';
import { useMobile } from './useMobile';
import backToTopStyles from './mobileBackToTop.module.css';

function isListPage(pathname: string) {
  return (
    /^\/admin\/(products|categories|tags|setting-styles|audit-logs)\/?$/.test(pathname) ||
    /^\/admin\/catalog\/[^/]+\/?$/.test(pathname) ||
    /^\/admin\/materials(\/categories|\/batches(\/[^/]+)?)?\/?$/.test(pathname) ||
    /^\/admin\/distributors(\/[^/]+)?\/?$/.test(pathname)
  );
}

export function MobileBackToTop() {
  const t = useTranslations('common');
  const pathname = usePathname();
  const mobile = useMobile();
  const enabled = mobile && isListPage(pathname);
  const [scroll, setScroll] = useState({ visible: false, progress: 0 });

  useEffect(() => {
    if (!enabled) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const root = document.documentElement;
      const viewportHeight = window.innerHeight;
      const scrollTop = Math.max(0, window.scrollY);
      const scrollableHeight = Math.max(0, root.scrollHeight - viewportHeight);
      setScroll({
        visible: scrollTop > viewportHeight && scrollableHeight > 0,
        progress: scrollableHeight > 0 ? Math.min(1, scrollTop / scrollableHeight) : 0,
      });
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    // Lists, expanded rows and images can change the page height without a scroll event.
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    scheduleUpdate();

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [enabled, pathname]);

  if (!enabled || !scroll.visible) return null;

  return (
    <button
      type="button"
      className={backToTopStyles.button}
      aria-label={t('backToTop')}
      title={t('backToTop')}
      onClick={() => {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
      }}
    >
      <svg className={backToTopStyles.ring} viewBox="0 0 48 48" aria-hidden="true">
        <circle className={backToTopStyles.track} cx="24" cy="24" r="22" />
        <circle
          className={backToTopStyles.progress}
          cx="24"
          cy="24"
          r="22"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 * (1 - scroll.progress)}
        />
      </svg>
      <ArrowUpOutlined aria-hidden="true" />
    </button>
  );
}
