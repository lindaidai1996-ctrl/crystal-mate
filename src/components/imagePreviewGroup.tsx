'use client';

import { Image } from 'antd';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
  type TouchEvent,
} from 'react';
import previewStyles from './imagePreviewGroup.module.css';

type AntGroupProps = ComponentProps<typeof Image.PreviewGroup>;
type GroupProps = Omit<AntGroupProps, 'items'> & {
  items: NonNullable<AntGroupProps['items']>;
};
type PreviewOptions = Exclude<GroupProps['preview'], boolean | undefined>;
type ToolbarInfo = Parameters<NonNullable<PreviewOptions['toolbarRender']>>[1];
type ImageInfo = Parameters<NonNullable<PreviewOptions['imageRender']>>[1];
type SwitchImage = NonNullable<ToolbarInfo['actions']['onActive']>;

/** Use explicit original-image items so preloading never fetches thumbnails. */
export function ImagePreviewGroup({ items, preview, ...props }: GroupProps) {
  const options = typeof preview === 'object' ? preview : {};
  const [opened, setOpened] = useState(false);
  const [index, setIndex] = useState(0);
  const visible = options.visible ?? opened;
  const current = options.current ?? index;
  const switchImage = useRef<SwitchImage | null>(null);
  const preloaded = useRef(new Map<string, HTMLImageElement>());

  useEffect(() => {
    if (!visible || preview === false) {
      preloaded.current.clear();
      return;
    }
    // Keep a small decoded window, prioritizing the next image over the previous one.
    const nearby = new Set<string>();
    for (const offset of [1, 2, -1, 0]) {
      const item = items[current + offset];
      const source = typeof item === 'string' ? { src: item } : item;
      if (typeof source?.src !== 'string' || !source.src) continue;
      nearby.add(source.src);
      if (preloaded.current.has(source.src)) continue;
      const image = new window.Image();
      image.decoding = 'async';
      if (source.crossOrigin) image.crossOrigin = source.crossOrigin;
      if (source.referrerPolicy) image.referrerPolicy = source.referrerPolicy;
      image.src = source.src;
      preloaded.current.set(source.src, image);
      // A failed speculative load must not interrupt the actual preview or become unhandled.
      void image.decode?.().catch(() => {});
    }
    for (const url of preloaded.current.keys()) {
      if (!nearby.has(url)) preloaded.current.delete(url);
    }
  }, [visible, current, items, preview]);

  return (
    <Image.PreviewGroup
      {...props}
      items={items}
      preview={
        preview === false
          ? false
          : {
              ...options,
              onVisibleChange: (next, previous, nextIndex) => {
                setOpened(next);
                setIndex(nextIndex);
                options.onVisibleChange?.(next, previous, nextIndex);
              },
              onChange: (next, previous) => {
                setIndex(next);
                options.onChange?.(next, previous);
              },
              toolbarRender: (node, info) => (
                <PreviewActions action={info.actions.onActive} actionRef={switchImage}>
                  {options.toolbarRender ? options.toolbarRender(node, info) : node}
                </PreviewActions>
              ),
              imageRender: (node, info) => (
                <SwipeImage
                  current={info.current}
                  items={items}
                  transform={info.transform}
                  minScale={options.minScale ?? 1}
                  visible={visible}
                  switchImage={switchImage}
                >
                  {options.imageRender ? options.imageRender(node, info) : node}
                </SwipeImage>
              ),
            }
      }
    />
  );
}

// The library exposes navigation actions in its toolbar, including transform reset.
function PreviewActions({
  action,
  actionRef,
  children,
}: {
  action: SwitchImage | undefined;
  actionRef: RefObject<SwitchImage | null>;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    actionRef.current = action ?? null;
    return () => {
      actionRef.current = null;
    };
  }, [action, actionRef]);
  return children;
}

function SwipeImage({
  current,
  items,
  transform,
  minScale,
  visible,
  switchImage,
  children,
}: {
  current: number;
  items: GroupProps['items'];
  transform: ImageInfo['transform'];
  minScale: number;
  visible: boolean;
  switchImage: RefObject<SwitchImage | null>;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const total = items.length;
  const previous = useRef(current);
  const swiped = useRef(false);
  const animation = useRef<Animation | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    offset: number;
    axis: 'pending' | 'horizontal' | 'vertical';
  } | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const element = surface.current;
    const direction = Math.sign(current - previous.current);
    previous.current = current;
    gesture.current = null;
    if (!element) return;
    element.style.transform = '';
    if (
      visible &&
      direction &&
      !swiped.current &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      animation.current = element.animate(
        [
          { transform: `translate3d(${direction * element.clientWidth}px, 0, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
    swiped.current = false;
    return () => {
      if (animation.current) {
        animation.current.onfinish = null;
        animation.current.cancel();
        animation.current = null;
      }
      gesture.current = null;
      element.style.transform = '';
    };
  }, [current, visible]);

  const resetDrag = () => {
    gesture.current = null;
    if (surface.current) surface.current.style.transform = '';
  };

  const finish = (event: TouchEvent<HTMLDivElement>, cancelled = false) => {
    const drag = gesture.current;
    const element = surface.current;
    if (!drag || !element) return;
    event.stopPropagation();
    gesture.current = null;
    const direction = drag.offset < 0 ? 1 : -1;
    const threshold = Math.min(80, Math.max(40, element.clientWidth * 0.16));
    const change =
      !cancelled &&
      drag.axis === 'horizontal' &&
      Math.abs(drag.offset) >= threshold &&
      current + direction >= 0 &&
      current + direction < total;
    const navigate = () => {
      element.style.transform = '';
      if (change) {
        swiped.current = true;
        switchImage.current?.(direction);
      }
    };
    if (!drag.offset || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigate();
      return;
    }
    animation.current?.cancel();
    animation.current = element.animate(
      [
        { transform: `translate3d(${drag.offset}px, 0, 0)` },
        { transform: `translate3d(${change ? -direction * element.clientWidth : 0}px, 0, 0)` },
      ],
      {
        duration: change ? 220 : 180,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      },
    );
    animation.current.onfinish = () => {
      animation.current?.cancel();
      animation.current = null;
      navigate();
    };
  };

  return (
    <div
      ref={surface}
      className={previewStyles.surface}
      onTouchStartCapture={(event) => {
        suppressClick.current = false;
        if (
          event.touches.length !== 1 ||
          transform.scale > minScale + 0.01 ||
          total < 2 ||
          !visible
        ) {
          resetDrag();
          return;
        }
        if (animation.current?.playState === 'running') {
          event.stopPropagation();
          return;
        }
        const touch = event.touches[0];
        gesture.current = {
          id: touch.identifier,
          x: touch.clientX,
          y: touch.clientY,
          offset: 0,
          axis: 'pending',
        };
        // Claim only unzoomed single-finger gestures; pinch and zoomed panning stay native.
        event.stopPropagation();
      }}
      onTouchMoveCapture={(event) => {
        const drag = gesture.current;
        if (!drag) return;
        if (event.touches.length !== 1) {
          resetDrag();
          return;
        }
        event.stopPropagation();
        const touch = event.touches[0];
        if (touch.identifier !== drag.id) return;
        const dx = touch.clientX - drag.x;
        const dy = touch.clientY - drag.y;
        if (drag.axis === 'pending' && Math.hypot(dx, dy) > 8) {
          drag.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical';
        }
        if (drag.axis !== 'horizontal') return;
        suppressClick.current = true;
        const atEdge = (dx > 0 && current === 0) || (dx < 0 && current === total - 1);
        drag.offset = dx * (atEdge ? 0.25 : 1);
        if (surface.current) {
          surface.current.style.transform = `translate3d(${drag.offset}px, 0, 0)`;
        }
      }}
      onTouchEndCapture={(event) => finish(event)}
      onTouchCancelCapture={(event) => finish(event, true)}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {visible &&
        [-1, 1].map((offset) => {
          const item = items[current + offset];
          const source = typeof item === 'string' ? { src: item } : item;
          if (typeof source?.src !== 'string' || !source.src) return null;
          return (
            <div
              key={offset}
              className={previewStyles.neighbor}
              style={{ transform: `translateX(${offset * 100}%)` }}
              aria-hidden="true"
            >
              {/* Original preview assets share the browser cache with the preloader. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img {...source} alt="" className="ant-image-preview-img" draggable={false} />
            </div>
          );
        })}
      {children}
    </div>
  );
}
