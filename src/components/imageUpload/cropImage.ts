import type { Area } from 'react-easy-crop';

// Export lossless pixels first; optional size/quality reduction happens after cropping.
export async function cropImage(file: File, area: Area, rotation: number): Promise<File> {
  if (area.width < 1 || area.height < 1) throw new Error('INVALID_CROP');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_UNAVAILABLE');
    const radians = (rotation * Math.PI) / 180;
    const width =
      Math.abs(bitmap.width * Math.cos(radians)) + Math.abs(bitmap.height * Math.sin(radians));
    const height =
      Math.abs(bitmap.width * Math.sin(radians)) + Math.abs(bitmap.height * Math.cos(radians));
    canvas.width = Math.round(area.width);
    canvas.height = Math.round(area.height);
    context.translate(width / 2 - area.x, height / 2 - area.y);
    context.rotate(radians);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result?.size && result.type === 'image/png') resolve(result);
        else reject(new Error('CROP_ENCODE_FAILED'));
      }, 'image/png');
    });
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' });
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
