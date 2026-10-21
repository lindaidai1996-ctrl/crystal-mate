'use client';

import { Alert, Button, Modal, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ImageCompressionDialog } from './imageCompressionDialog';
import { ImageCropDialog } from './imageCropDialog';
import { validateImageSource, type UploadImageSource } from './prepareImages';

export function AttachmentImageEditor({
  url,
  fileName,
  onCancel,
  onConfirm,
}: {
  url: string;
  fileName: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}) {
  const t = useTranslations('imageUpload');
  const common = useTranslations('common');
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sources, setSources] = useState<UploadImageSource[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('IMAGE_LOAD_FAILED');
        const blob = await response.blob();
        const source = new File([blob], fileName, { type: blob.type });
        if (validateImageSource(source)) throw new Error('INVALID_IMAGE');
        if (!controller.signal.aborted) setFile(source);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [url, fileName, attempt]);

  if (sources) {
    return (
      <ImageCompressionDialog
        sources={sources}
        onCancel={onCancel}
        onConfirm={(files) => onConfirm(files[0])}
        onBack={() => setSources(null)}
      />
    );
  }

  if (file) {
    return (
      <ImageCropDialog
        file={file}
        index={0}
        total={1}
        onCancel={onCancel}
        onKeep={onCancel}
        onCrop={(cropped) => setSources([{ file: cropped, cropped: true }])}
      />
    );
  }

  return (
    <Modal
      title={t('editImage')}
      open
      centered
      onCancel={onCancel}
      footer={<Button onClick={onCancel}>{t('cancel')}</Button>}
    >
      {failed ? (
        <Alert
          type="error"
          showIcon
          message={t('loadFailed')}
          action={
            <Button
              size="small"
              onClick={() => {
                setFailed(false);
                setAttempt((current) => current + 1);
              }}
            >
              {common('retry')}
            </Button>
          }
        />
      ) : (
        <div className="image-upload-preparing">
          <Spin />
          <span>{t('loadingImage')}</span>
        </div>
      )}
    </Modal>
  );
}
