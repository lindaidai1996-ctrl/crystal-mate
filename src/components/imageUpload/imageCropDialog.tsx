'use client';

import { Alert, Button, Modal, Segmented, Slider, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { cropImage } from './cropImage';
import { validateImageSource } from './prepareImages';

export function ImageCropDialog({
  file,
  index,
  total,
  onCancel,
  onCrop,
  onKeep,
  onRemove,
}: {
  file: File;
  index: number;
  total: number;
  onCancel: () => void;
  onCrop: (file: File) => void;
  onKeep: () => void;
  onRemove?: () => void;
}) {
  const t = useTranslations('imageUpload');
  const [url, setUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [ratio, setRatio] = useState('original');
  const [originalRatio, setOriginalRatio] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const active = useRef(true);
  const sourceError = validateImageSource(file);

  useEffect(() => {
    active.current = true;
    if (sourceError) return;
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setUrl(objectUrl);
    image.onerror = () => setFailed(true);
    image.src = objectUrl;
    return () => {
      active.current = false;
      image.onload = image.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, sourceError]);

  async function confirmCrop() {
    if (!area || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await cropImage(file, area, rotation);
      if (active.current) onCrop(result);
    } catch {
      if (active.current) setSaveError(true);
    } finally {
      if (active.current) setSaving(false);
    }
  }

  return (
    <Modal
      title={t('cropTitle', { current: index + 1, total })}
      open
      style={{ top: 24 }}
      width={640}
      onCancel={onCancel}
      footer={
        <div className="image-crop-footer">
          {onRemove && (
            <Button onClick={onRemove} disabled={saving} danger>
              {t('removeImage')}
            </Button>
          )}
          <div className="image-crop-footer-actions">
            <Button onClick={onCancel}>{t('cancel')}</Button>
            <Button onClick={onKeep} disabled={saving || !loaded || !!sourceError || failed}>
              {t('keepWhole')}
            </Button>
            <Button
              type="primary"
              onClick={() => void confirmCrop()}
              loading={saving}
              disabled={!loaded || !area || !!sourceError || failed}
            >
              {t('applyCrop')}
            </Button>
          </div>
        </div>
      }
    >
      <p className="image-upload-name">{file.name}</p>
      <p className="helper-text">{t('cropHelp')}</p>
      {sourceError || failed ? (
        <Alert type="error" showIcon message={t(sourceError ?? 'decodeFailed')} />
      ) : (
        <>
          <div className="image-crop-stage" aria-busy={!loaded} inert={saving}>
            {!loaded && <Spin />}
            {url && (
              <Cropper
                image={url}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={ratio === 'original' ? originalRatio : Number(ratio)}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onRotationChange={setRotation}
                onCropAreaChange={(_, pixels) => setArea(pixels)}
                onMediaLoaded={({ naturalWidth, naturalHeight }) => {
                  setOriginalRatio(naturalWidth / naturalHeight);
                  setLoaded(true);
                }}
                mediaProps={{ alt: file.name, onError: () => setFailed(true) }}
                cropperProps={{ 'aria-label': t('cropArea') }}
                disableAutomaticStylesInjection
              />
            )}
          </div>
          <div className="image-crop-controls">
            <Segmented
              block
              aria-label={t('cropRatio')}
              value={ratio}
              disabled={!loaded || saving}
              onChange={(value) => {
                setRatio(value);
                setZoom(1);
                setCrop({ x: 0, y: 0 });
              }}
              options={[
                { label: t('originalRatio'), value: 'original' },
                { label: '1:1', value: '1' },
                { label: '4:3', value: String(4 / 3) },
                { label: '3:4', value: String(3 / 4) },
                { label: '16:9', value: String(16 / 9) },
              ]}
            />
            <div className="image-crop-slider">
              <span>{t('zoom')}</span>
              <Slider
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={setZoom}
                disabled={!loaded || saving}
                ariaLabelForHandle={t('zoom')}
              />
            </div>
            <div className="image-crop-slider">
              <span>{t('rotation')}</span>
              <Slider
                min={-180}
                max={180}
                value={rotation}
                onChange={setRotation}
                disabled={!loaded || saving}
                ariaLabelForHandle={t('rotation')}
                tooltip={{ formatter: (value) => `${value}°` }}
              />
            </div>
            <Button
              size="small"
              disabled={saving}
              onClick={() => {
                setCrop({ x: 0, y: 0 });
                setZoom(1);
                setRotation(0);
                setRatio('original');
              }}
            >
              {t('resetCrop')}
            </Button>
          </div>
          {saveError && <Alert type="error" showIcon message={t('cropFailed')} />}
        </>
      )}
    </Modal>
  );
}
