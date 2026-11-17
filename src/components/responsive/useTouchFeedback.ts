'use client';

import { useEffect } from 'react';

const controlSelector = [
  'button',
  '[role="button"]',
  '.ant-image-preview-close',
  '.ant-image-preview-switch-left',
  '.ant-image-preview-switch-right',
  '.ant-image-preview-operations-operation',
].join(',');

const disabledSelector = [
  ':disabled',
  '[aria-disabled="true"]',
  '[aria-busy="true"]',
  '.ant-btn-loading',
  '.ant-image-preview-switch-left-disabled',
  '.ant-image-preview-switch-right-disabled',
  '.ant-image-preview-operations-operation-disabled',
].join(',');

/** Touch browsers do not consistently apply :active to the preview's clickable divs. */
export function useTouchFeedback() {
  useEffect(() => {
    let pressed: { element: Element; pointerId: number; x: number; y: number } | null = null;
    const clear = () => {
      pressed?.element.removeAttribute('data-touch-pressed');
      pressed = null;
    };
    const start = (event: PointerEvent) => {
      clear();
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      const element =
        event.target instanceof Element ? event.target.closest(controlSelector) : null;
      if (!element || element.matches(disabledSelector)) return;
      element.setAttribute('data-touch-pressed', '');
      pressed = { element, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (
        pressed?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10
      ) {
        clear();
      }
    };
    const end = (event: PointerEvent) => {
      if (pressed?.pointerId === event.pointerId) clear();
    };

    // Capture also covers controls in portals and children that stop propagation.
    document.addEventListener('pointerdown', start, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      clear();
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
}
