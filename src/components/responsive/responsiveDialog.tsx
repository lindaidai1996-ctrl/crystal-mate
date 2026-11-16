'use client';

import { Drawer, Modal, type DrawerProps, type ModalProps } from 'antd';
import { useMobile } from './useMobile';
import mobileStyles from './responsive.module.css';

export function ResponsiveDrawer({ rootClassName, ...props }: DrawerProps) {
  const mobile = useMobile();
  return (
    <Drawer
      {...props}
      rootClassName={[mobileStyles.editorSheet, rootClassName].filter(Boolean).join(' ')}
      placement={mobile ? 'bottom' : props.placement}
      height={mobile ? '100dvh' : props.height}
      width={mobile ? '100vw' : props.width}
    />
  );
}

export function ResponsiveModal({ rootClassName, ...props }: ModalProps) {
  return (
    <Modal
      {...props}
      rootClassName={[mobileStyles.modal, rootClassName].filter(Boolean).join(' ')}
    />
  );
}
