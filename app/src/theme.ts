/**
 * Palm design tokens — light, private-payments palette.
 *
 * Colors, radii, spacing and typography extracted from the "Palm — Private
 * Payments" design. `theme.colors` keeps the generic token names the rest of
 * the app already references; `palm` adds the fuller palette the redesigned
 * screens use directly.
 */

export const palm = {
  // surfaces
  screen: '#F6F8F6',
  screenOuter: '#ECF0ED',
  card: '#FFFFFF',
  cardAlt: '#FBFCFB',
  fill: '#F0F4F1',

  // brand greens
  green: '#0B5C43',
  greenHover: '#0A4E39',
  greenDeep: '#0D3B2E',
  greenTintBg: '#EAF1EC',
  greenTintBorder: '#D5E3DA',
  mint: '#7FD1AF',

  // ink
  ink: '#0F1F19',
  inkSoft: '#3E4C45',
  inkDim: '#5F6E66',
  inkFaint: '#8A968F',
  inkGhost: '#B9C3BC',

  // borders
  border: '#E3E9E5',
  borderSoft: '#E9EFEA',
  hairline: '#F0F4F1',

  // on dark
  onDark: '#FFFFFF',
  onDarkDim: '#9DBFAF',
  onDarkFaint: '#7B8880',

  // status — amber
  amber: '#8A5A10',
  amberInk: '#6B4A10',
  amberBg: '#FBF3E4',
  amberBgStrong: '#F7E9CB',
  amberTint: '#F2EEDB',

  // status — danger
  danger: '#B3372F',
  dangerBg: '#FBF0EE',
  dangerBorder: '#EED4D0',
  dangerInk: '#8A5A55',

  // notification surface
  notif: '#1B2620',

  // avatar palette (deterministic marks)
  markTints: ['#DCEFE6', '#D9ECEC', '#E6EFDA', '#DFE9E4'],
  markFgs: ['#0B5C43', '#0E5A5E', '#55701F', '#3A5A4C'],
  markShapes: ['3px', '50%', '3px', '50% 50% 50% 4px'] as const,
  markRots: [45, 0, 0, 0],
} as const;

/** Font family names registered by @expo-google-fonts/instrument-sans. */
export const font = {
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
} as const;

/** Back-compat generic token surface (used by older primitives). */
export const theme = {
  colors: {
    bg: palm.screen,
    surface: palm.card,
    surfaceAlt: palm.cardAlt,
    border: palm.border,
    text: palm.ink,
    textDim: palm.inkDim,
    primary: palm.green,
    primaryText: palm.onDark,
    success: palm.green,
    danger: palm.danger,
    warning: palm.amber,
  },
  radius: 16,
  space: (n: number) => n * 4,
} as const;

export type Theme = typeof theme;
