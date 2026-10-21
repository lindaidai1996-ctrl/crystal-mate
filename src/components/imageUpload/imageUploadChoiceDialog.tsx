'use client';

import { useState } from 'react';
import { ImageCropDialog } from './imageCropDialog';
import { ImageCompressionDialog } from './imageCompressionDialog';
import type { UploadImageSource } from './prepareImages';

export function ImageUploadChoiceDialog({
  files,
  askCompression = false,
  onCancel,
  onConfirm,
}: {
  files: File[];
  askCompression?: boolean;
  onCancel: () => void;
  onConfirm: (files: File[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [sources, setSources] = useState<UploadImageSource[]>([]);

  function advance(source?: UploadImageSource) {
    const next = source ? [...sources, source] : sources;
    if (index === files.length - 1 && !next.length) {
      onCancel();
      return;
    }
    setSources(next);
    setIndex(index + 1);
  }

  if (index < files.length) {
    return (
      <ImageCropDialog
        key={index}
        file={files[index]}
        index={index}
        total={files.length}
        onCancel={onCancel}
        onCrop={(file) => advance({ file, cropped: true })}
        onKeep={() => advance({ file: files[index], cropped: false })}
        onRemove={() => advance()}
      />
    );
  }

  return (
    <ImageCompressionDialog
      sources={sources}
      askCompression={askCompression}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onBack={() => {
        setIndex(0);
        setSources([]);
      }}
    />
  );
}
