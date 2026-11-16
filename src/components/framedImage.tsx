import { LoadingImage } from './loadingImage';
import { imageFramingStyle, type ImageFraming } from '@/lib/image-framing';
import frameStyles from './framedImage.module.css';

export function FramedImage({
  src,
  alt = '',
  framing,
}: {
  src: string;
  alt?: string;
  framing?: ImageFraming | null;
}) {
  return (
    <span className={frameStyles.frame}>
      <LoadingImage
        src={src}
        alt={alt}
        width={640}
        height={640}
        draggable={false}
        style={imageFramingStyle(framing)}
      />
    </span>
  );
}
