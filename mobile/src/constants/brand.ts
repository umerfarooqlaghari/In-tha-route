/**
 * In Tha Route — Design System
 *
 * Neutral, airy surfaces (Uber-style) with a softened version of the legacy
 * "In Tha Route" red used sparingly as an accent: primary actions, active
 * states and brand marks only. Everything else stays calm and neutral.
 */
export const Brand = {
  colors: {
    // Surfaces
    bg: '#F6F7F9',
    surface: '#FFFFFF',
    surfaceAlt: '#F1F2F5',
    overlay: 'rgba(17, 18, 20, 0.36)',

    // Lines
    line: '#ECEDF0',
    lineStrong: '#DADCE1',

    // Ink (text)
    ink: '#14151A',
    ink2: '#50535C',
    ink3: '#8B8F98',
    inkInverse: '#FFFFFF',

    // Brand accent — softened legacy red
    primary: '#E5484D',
    primaryPressed: '#CF3C42',
    primarySoft: '#FFF2F2',
    primaryLine: '#FBD5D6',

    // Status
    success: '#14A35A',
    successSoft: '#EAF8F0',
    warning: '#C27803',
    warningSoft: '#FFF6E6',
    info: '#2F6FED',
    infoSoft: '#EEF3FE',

    // Order sources
    deliveroo: '#00A8A0',
    uberEats: '#06C167',
    eatPresto: '#7A5AF8',
    justEat: '#FF8000',
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 22,
    pill: 999,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
  },
  type: {
    display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6 },
    title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
    heading: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
    body: { fontSize: 15, fontWeight: '400' as const },
    bodyStrong: { fontSize: 15, fontWeight: '600' as const },
    caption: { fontSize: 13, fontWeight: '400' as const },
    captionStrong: { fontSize: 13, fontWeight: '600' as const },
    micro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
  },
  shadow: {
    card: {
      shadowColor: '#0B0C10',
      shadowOpacity: 0.05,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    floating: {
      shadowColor: '#0B0C10',
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  },
};

export type SourceKey = 'Deliveroo' | 'Uber Eats' | 'Eat Presto POS' | 'Just Eat';

export const SOURCE_COLORS: Record<SourceKey, string> = {
  Deliveroo: Brand.colors.deliveroo,
  'Uber Eats': Brand.colors.uberEats,
  'Eat Presto POS': Brand.colors.eatPresto,
  'Just Eat': Brand.colors.justEat,
};

export const formatGbp = (value: number) => `£${value.toFixed(2)}`;

export const formatCountdown = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};
