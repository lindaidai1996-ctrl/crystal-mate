'use client';

import { Image, type ImageProps } from 'antd';
import NextImage, { type ImageProps as NextImageProps } from 'next/image';
import { useEffect, useRef, useState } from 'react';
import imageStyles from './loadingImage.module.css';

const emptyImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
const failedImage =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" fill="#f0f0f0"/>' +
      '<path d="M24 26h32v28H24z M24 48l10-10 10 10 5-5 7 7" ' +
      'fill="none" stroke="#999999" stroke-width="2"/></svg>',
  );

export function ImageSkeleton() {
  return <span className={imageStyles.skeleton} aria-hidden="true" />;
}

type LoadingImageProps = Omit<NextImageProps, 'src'> & { src: string };

/** Keep the image's existing dimensions and CSS selectors, including in zoomable canvases. */
export function LoadingImage(props: LoadingImageProps) {
  return <LoadingImageState key={props.src} {...props} />;
}

function LoadingImageState({
  className,
  onLoad,
  onError,
  src,
  alt,
  loading = 'lazy',
  ...props
}: LoadingImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  return (
    <NextImage
      {...props}
      unoptimized
      src={status === 'error' ? failedImage : src}
      alt={alt}
      loading={loading}
      decoding="async"
      className={[
        className,
        status === 'loading' ? imageStyles.loading : '',
        status === 'loaded' ? imageStyles.loaded : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-busy={status === 'loading'}
      onLoad={(event) => {
        if (status === 'error') return;
        setStatus('loaded');
        onLoad?.(event);
      }}
      onError={(event) => {
        setStatus('error');
        onError?.(event);
      }}
    />
  );
}

/** rc-image validates src eagerly, so withhold the remote URL until it is near the viewport. */
export function LazyPreviewImage(props: ImageProps) {
  return <LazyPreviewImageState key={props.src} {...props} />;
}

function LazyPreviewImageState({
  src,
  alt = '',
  width,
  height = width,
  preview = true,
  loading = 'lazy',
  ...props
}: ImageProps) {
  const frame = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(loading === 'eager');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (visible) return;
    const element = frame.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      const scheduled = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(scheduled);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <span
      ref={frame}
      className={imageStyles.frame}
      style={{ width, height }}
      data-loaded={loaded}
      onLoadCapture={(event) => {
        const image = event.target;
        if (
          visible &&
          image instanceof HTMLImageElement &&
          image.getAttribute('src') !== emptyImage
        ) {
          setLoaded(true);
        }
      }}
    >
      <Image
        {...props}
        alt={alt}
        src={visible ? src : emptyImage}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        placeholder={<ImageSkeleton />}
        fallback={failedImage}
        preview={
          preview === false ? false : { src, ...(typeof preview === 'object' ? preview : {}) }
        }
      />
      {!visible && (
        <span className={imageStyles.pending}>
          <ImageSkeleton />
        </span>
      )}
    </span>
  );
}
