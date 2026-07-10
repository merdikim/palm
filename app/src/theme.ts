/** Plain dark-friendly theme tokens for the test build. */
export const theme = {
  colors: {
    bg: '#0b0d12',
    surface: '#151922',
    surfaceAlt: '#1d2330',
    border: '#2a3140',
    text: '#e8ecf3',
    textDim: '#9aa4b5',
    primary: '#5b8cff',
    primaryText: '#ffffff',
    success: '#3ecf8e',
    danger: '#ff5c66',
    warning: '#ffb020',
  },
  radius: 12,
  space: (n: number) => n * 4,
} as const;

export type Theme = typeof theme;
