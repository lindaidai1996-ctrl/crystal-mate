import { LoadingImage } from './loadingImage';
import type { ReactEventHandler } from 'react';
import { imageFramingStyle, type ImageFraming } from '@/lib/image-framing';
import frameStyles from './framedImage.module.css';

export function FramedImage({
  src,
  alt = '',
  framing,
  onLoad,
}: {
  src: string;
  alt?: string;
  framing?: ImageFraming | null;
  onLoad?: ReactEventHandler<HTMLImageElement>;
}) {
  return (
    <span className={frameStyles.frame}>
      <LoadingImage
        src={src}
        alt={alt}
        width={640}
        height={640}
        draggable={false}
        onLoad={onLoad}
        style={imageFramingStyle(framing)}
      />
    </span>
  );
}
