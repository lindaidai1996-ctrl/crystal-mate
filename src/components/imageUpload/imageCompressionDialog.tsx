'use client';

import { Alert, Button, Modal, Segmented, Spin, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  formatImageBytes,
  MAX_UPLOAD_BYTES,
  prepareImage,
  type PreparedImage,
  type UploadImageSource,
} from './prepareImages';

type UploadMode = 'compressed' | 'original';

export function ImageCompressionDialog({
  sources,
  askCompression = false,
  onCancel,
  onConfirm,
  onBack,
}: {
  sources: UploadImageSource[];
  askCompression?: boolean;
  onCancel: () => void;
  onConfirm: (files: File[]) => void;
  onBack: () => void;
}) {
  const t = useTranslations('imageUpload');
  const [prepared, setPrepared] = useState<PreparedImage[] | null>(null);
  const [mode, setMode] = useState<UploadMode>('compressed');

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      const results: PreparedImage[] = [];
      for (const { file, cropped } of sources) {
        if (cancelled) break;
        results.push(await prepareImage(file, { cropped }));
      }
      if (!cancelled) setPrepared(results);
    }
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  const hasCropped = sources.some(({ cropped }) => cropped);

  const canUploadOriginal =
    prepared?.every(
      ({ original, error }) =>
        error !== 'invalid' &&
        error !== 'tooLarge' &&
        original.size > 0 &&
        original.size <= MAX_UPLOAD_BYTES &&
        ['image/jpeg', 'image/png', 'image/webp'].includes(original.type),
    ) ?? false;
  const canUploadCompressed = prepared?.every(({ compressed }) => compressed !== null) ?? false;

  return (
    <Modal
      title={t(askCompression ? 'compressionQuestion' : 'title')}
      open
      centered
      width={560}
      onCancel={onCancel}
      onOk={() => {
        if (!prepared || !(mode === 'original' ? canUploadOriginal : canUploadCompressed)) return;
        onConfirm(prepared.map((item) => (mode === 'original' ? item.original : item.compressed!)));
      }}
      okText={t('upload')}
      okButtonProps={{ disabled: !(mode === 'original' ? canUploadOriginal : canUploadCompressed) }}
      cancelText={t('cancel')}
      footer={(_, { OkBtn, CancelBtn }) => (
        <div className="image-crop-footer">
          <Button onClick={onBack}>{t('backToCrop')}</Button>
          <div className="image-crop-footer-actions">
            <CancelBtn />
            <OkBtn />
          </div>
        </div>
      )}
    >
      {!prepared ? (
        <div className="image-upload-preparing">
          <Spin />
          <span>{t('preparing')}</span>
        </div>
      ) : (
        <div className="image-upload-choice">
          {hasCropped && <Alert type="info" showIcon message={t('croppedVersionHelp')} />}
          <Segmented<UploadMode>
            block
            value={mode}
            onChange={setMode}
            options={[
              {
                label: t(askCompression ? 'compressYes' : 'compressed'),
                value: 'compressed',
                disabled: !canUploadCompressed,
              },
              {
                label: t(hasCropped ? 'uncompressed' : askCompression ? 'compressNo' : 'original'),
                value: 'original',
                disabled: !canUploadOriginal,
              },
            ]}
          />
          {!canUploadOriginal && canUploadCompressed && (
            <Alert type="info" showIcon message={t('originalUnavailable')} />
          )}
          {!canUploadCompressed && !canUploadOriginal && (
            <Alert type="error" showIcon message={t('noValidOption')} />
          )}
          <div className="image-upload-list">
            {prepared.map((item, index) => (
              <div className="image-upload-row" key={`${item.original.name}-${index}`}>
                <Tooltip title={item.original.name}>
                  <span className="image-upload-name">{item.original.name}</span>
                </Tooltip>
                <span className="image-upload-sizes">
                  {t(sources[index].cropped ? 'croppedSize' : 'originalSize', {
                    size: formatImageBytes(item.original.size),
                  })}
                  {' · '}
                  {item.error
                    ? t(item.error)
                    : item.unchanged
                      ? t(sources[index].cropped ? 'croppedUnchanged' : 'unchanged')
                      : t('compressedSize', { size: formatImageBytes(item.compressed!.size) })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
