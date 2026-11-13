import type { ThemeConfig } from 'antd';

const jade = {
  text: '#2f735c',
  border: '#89b6a3',
  background: '#eaf5ef',
  hover: '#e1f0e8',
};

// Shared with the login page so the brand also reaches menus, drawers and portals.
const brand = {
  primary: '#547566',
  ink: '#30483e',
  muted: '#607266',
  canvas: '#f7f8f2',
  border: '#dce4dc',
  selected: '#e8efe7',
};

export const uiTheme: ThemeConfig = {
  cssVar: { key: 'crystal-mate' },
  token: {
    colorPrimary: brand.primary,
    colorInfo: brand.primary,
    colorLink: brand.primary,
    colorBgLayout: brand.canvas,
    colorBgContainer: '#ffffff',
    colorText: brand.ink,
    colorTextSecondary: brand.muted,
    colorTextTertiary: brand.muted,
    colorTextPlaceholder: '#89958c',
    colorBorder: brand.border,
    colorBorderSecondary: '#e5eae2',
    colorFillAlter: '#eff3ed',
    colorPrimaryBg: brand.selected,
    colorPrimaryBgHover: '#dfe9de',
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    controlHeight: 44,
    controlHeightSM: 32,
    fontSize: 14,
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    motionDurationMid: '0.16s',
    motionDurationSlow: '0.16s',
    boxShadow: '0 8px 28px rgb(48 72 62 / 6%)',
    boxShadowSecondary: '0 12px 40px rgb(48 72 62 / 9%)',
  },
  components: {
    Alert: {
      colorInfo: jade.text,
      colorInfoBg: '#f3f9f5',
      colorInfoBorder: '#d7e8df',
      colorSuccess: jade.text,
      colorSuccessBg: '#f3f9f5',
      colorSuccessBorder: '#d7e8df',
      colorWarning: '#a17c3a',
      colorWarningBg: '#fcf8ed',
      colorWarningBorder: '#eee1bf',
      colorError: '#b75e62',
      colorErrorBg: '#fdf3f2',
      colorErrorBorder: '#f0d9d7',
      borderRadiusLG: 6,
      defaultPadding: '12px 16px',
    },
    Button: { primaryShadow: 'none', defaultShadow: 'none', paddingInline: 20 },
    Menu: {
      itemBg: 'transparent',
      itemColor: '#52685a',
      itemHoverBg: '#e5ece1',
      itemHoverColor: brand.ink,
      itemSelectedBg: '#dfe9dc',
      itemSelectedColor: '#3f6351',
      groupTitleColor: brand.muted,
      itemBorderRadius: 8,
      itemHeight: 48,
      itemMarginInline: 0,
      iconSize: 16,
    },
    Table: {
      headerBg: '#f1f4ee',
      headerColor: brand.muted,
      headerSplitColor: 'transparent',
      rowHoverBg: '#f4f7f0',
      borderColor: '#e5eae2',
    },
    Input: { activeShadow: '0 0 0 3px rgb(84 117 102 / 10%)' },
    InputNumber: { activeShadow: '0 0 0 3px rgb(84 117 102 / 10%)' },
    Select: { optionSelectedBg: brand.selected, activeOutlineColor: 'rgb(84 117 102 / 10%)' },
    Tooltip: {
      colorBgSpotlight: '#ffffff',
      colorTextLightSolid: brand.ink,
      fontSize: 12,
      lineHeight: 1.6,
      controlHeight: 28,
      paddingXS: 10,
      paddingSM: 12,
      boxShadowSecondary: '0 3px 12px rgb(48 72 62 / 8%)',
    },
    Segmented: {
      trackBg: '#eff3ed',
      itemSelectedBg: '#ffffff',
      itemSelectedColor: brand.primary,
    },
    Pagination: { itemActiveBg: brand.selected },
    Modal: { titleFontSize: 16 },
    Form: { labelColor: brand.ink, verticalLabelPadding: '0 0 10px' },
  },
};

export const loginTheme: ThemeConfig = {
  cssVar: { key: 'crystal-login' },
  token: {
    colorPrimary: brand.primary,
    colorInfo: brand.primary,
    colorText: brand.ink,
    colorTextSecondary: brand.muted,
    colorTextPlaceholder: '#89958c',
    colorBorder: brand.border,
    colorError: '#b8625e',
    borderRadius: 12,
    controlHeightLG: 46,
    fontSize: 14,
  },
  components: {
    Input: { borderRadiusLG: 10, activeShadow: '0 0 0 3px rgb(84 117 102 / 10%)' },
    Form: { labelColor: '#40564b', verticalLabelPadding: '0 0 7px' },
    Checkbox: { borderRadiusSM: 5 },
  },
};

export const imageUploadModeTheme: ThemeConfig = {
  cssVar: { key: 'image-upload-mode' },
  token: {
    colorPrimary: jade.text,
    colorPrimaryHover: '#40876e',
    colorPrimaryBg: jade.background,
    colorPrimaryBgHover: jade.hover,
    colorPrimaryBorder: jade.border,
  },
  components: {
    Segmented: {
      trackBg: 'transparent',
      trackPadding: 0,
      itemSelectedBg: jade.background,
      itemSelectedColor: jade.text,
      itemHoverBg: '#f5f9f7',
      itemHoverColor: jade.text,
      itemActiveBg: jade.hover,
    },
  },
};

export const underlinedTheme: ThemeConfig = {
  cssVar: { key: 'catalog-fields' },
  components: {
    Input: { colorBgContainer: 'transparent', activeBg: 'transparent', hoverBg: 'transparent' },
    InputNumber: {
      colorBgContainer: 'transparent',
      activeBg: 'transparent',
      hoverBg: 'transparent',
    },
    Select: { selectorBg: 'transparent' },
    DatePicker: {
      colorBgContainer: 'transparent',
      activeBg: 'transparent',
      hoverBg: 'transparent',
    },
  },
};
