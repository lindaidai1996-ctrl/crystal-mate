import type { ThemeConfig } from 'antd';

const jade = {
  text: '#2f735c',
  border: '#89b6a3',
  background: '#eaf5ef',
  hover: '#e1f0e8',
};

// Platinum palette, shared by the application and all Ant Design portals.
export const uiTheme: ThemeConfig = {
  cssVar: { key: 'crystal-mate' },
  token: {
    colorPrimary: '#4c596a',
    colorInfo: '#4c596a',
    colorLink: '#4c596a',
    colorBgLayout: '#f5f6f7',
    colorBgContainer: '#ffffff',
    colorText: '#242930',
    colorTextSecondary: '#646b75',
    colorTextTertiary: '#646b75',
    colorBorder: '#c8ced5',
    colorBorderSecondary: '#e1e5e9',
    colorFillAlter: '#eff1f3',
    colorPrimaryBg: '#e9edf2',
    colorPrimaryBgHover: '#e1e6ed',
    borderRadius: 0,
    borderRadiusLG: 0,
    borderRadiusSM: 0,
    controlHeight: 44,
    controlHeightSM: 32,
    fontSize: 14,
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    motionDurationMid: '0.16s',
    motionDurationSlow: '0.16s',
    boxShadow: '0 8px 28px rgb(32 36 43 / 8%)',
    boxShadowSecondary: '0 12px 40px rgb(32 36 43 / 9%)',
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
      darkItemBg: '#20242b',
      darkItemColor: '#b9bec7',
      darkItemHoverBg: '#353e4b',
      darkItemSelectedBg: '#353e4b',
      darkItemSelectedColor: '#e2e8f1',
      itemBorderRadius: 0,
      itemHeight: 48,
      itemMarginInline: 0,
      iconSize: 16,
    },
    Table: {
      headerBg: '#f5f6f7',
      headerColor: '#646b75',
      headerSplitColor: 'transparent',
      rowHoverBg: '#eff1f3',
      borderColor: '#e1e5e9',
    },
    Input: { activeShadow: '0 1px 0 #4c596a' },
    InputNumber: { activeShadow: '0 1px 0 #4c596a' },
    Select: { optionSelectedBg: '#e9edf2', activeOutlineColor: 'rgb(76 89 106 / 12%)' },
    Tooltip: {
      colorBgSpotlight: '#ffffff',
      colorTextLightSolid: '#242930',
      fontSize: 12,
      lineHeight: 1.6,
      controlHeight: 28,
      paddingXS: 10,
      paddingSM: 12,
      boxShadowSecondary: '0 3px 12px rgb(32 36 43 / 8%)',
    },
    Segmented: { trackBg: '#eff1f3', itemSelectedBg: '#e9edf2', itemSelectedColor: '#4c596a' },
    Pagination: { itemActiveBg: '#e9edf2' },
    Modal: { titleFontSize: 16 },
    Form: { labelColor: '#242930', verticalLabelPadding: '0 0 10px' },
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
