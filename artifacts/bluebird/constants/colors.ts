/**
 * Bluebird design tokens — dark navy & electric blue palette
 * Brand: #060B1F deep navy, #1259F2 electric blue primary.
 *
 * `dark` is the original brand-dark palette; `light` is a true light
 * palette that keeps the brand blues consistent.
 */

const dark = {
  // ── Core surfaces ──────────────────────────────────────────────
  background:     '#060B1F',   // deepest dark — tab screens
  backgroundMid:  '#0A1128',   // headers, splash, confirmed screen
  card:           '#0D1636',   // elevated cards, discover rows
  cardHigh:       '#0F1B3D',   // modals, detail panels
  offWhite:       '#0A1128',   // "settings-style" surface (light in light mode)
  surface:        '#0D1636',   // settings cards / list rows (was hardcoded #fff)

  foreground:     '#FFFFFF',
  cardForeground: '#FFFFFF',

  // ── Primary action (Bluebird blue) ────────────────────────────
  primary:            '#1259F2',
  primaryForeground:  '#FFFFFF',

  // ── Blue family ───────────────────────────────────────────────
  paleBlue:       '#7FA8FA',   // prices, discounts, secondary highlights
  paleBlueFaint:  '#BFD3FB',   // muted interactive elements

  // ── Secondary surfaces ────────────────────────────────────────
  secondary:          '#1A2744',
  secondaryForeground:'#FFFFFF',

  // ── Muted / subdued ───────────────────────────────────────────
  muted:              '#1A2744',
  mutedForeground:    '#8896B3',              // on dark surfaces
  mutedForegroundLight: 'rgba(255,255,255,0.55)', // muted text on `offWhite`/`surface`
  textOnSurface:      '#FFFFFF',              // strong text on `offWhite`/`surface`
  separator:          'rgba(255,255,255,0.08)',

  // ── Accent ────────────────────────────────────────────────────
  accent:            '#1259F2',
  accentForeground:  '#FFFFFF',

  // ── Status ────────────────────────────────────────────────────
  success:            '#1E9E5C',
  successForeground:  '#FFFFFF',
  destructive:        '#FF3B30',
  destructiveForeground: '#FFFFFF',
  coral:              '#FFB199',              // alert / warm accent

  // ── Borders & inputs ──────────────────────────────────────────
  border: '#1E2D4F',
  input:  '#1A2744',

  // ── Navigation chrome ─────────────────────────────────────────
  headerBackground: '#0A1128',
  headerForeground: '#FFFFFF',

  // ── Legacy aliases ────────────────────────────────────────────
  text: '#FFFFFF',
  tint: '#1259F2',
};

const light: typeof dark = {
  // ── Core surfaces ──────────────────────────────────────────────
  background:     '#F2F5FB',
  backgroundMid:  '#0A1128',   // brand navy — still used for avatars / hero blocks
  card:           '#FFFFFF',
  cardHigh:       '#FFFFFF',
  offWhite:       '#FAFAF8',
  surface:        '#FFFFFF',

  foreground:     '#0A1128',
  cardForeground: '#0A1128',

  primary:            '#1259F2',
  primaryForeground:  '#FFFFFF',

  paleBlue:       '#3D74F4',
  paleBlueFaint:  '#7FA8FA',

  secondary:          '#E8EEFB',
  secondaryForeground:'#0A1128',

  muted:              '#EDF1F9',
  mutedForeground:    'rgba(10,17,40,0.55)',
  mutedForegroundLight: 'rgba(10,17,40,0.45)',
  textOnSurface:      '#0A1128',
  separator:          'rgba(10,17,40,0.06)',

  accent:            '#1259F2',
  accentForeground:  '#FFFFFF',

  success:            '#1E9E5C',
  successForeground:  '#FFFFFF',
  destructive:        '#FF3B30',
  destructiveForeground: '#FFFFFF',
  coral:              '#E8663C',

  border: '#DFE6F3',
  input:  '#E8EEFB',

  headerBackground: '#FFFFFF',
  headerForeground: '#0A1128',

  text: '#0A1128',
  tint: '#1259F2',
};

const colors = {
  light,
  dark,

  // ── Radius scale ────────────────────────────────────────────────
  radius:     18,   // standard cards
  radiusLg:   24,   // featured cards, hero overlays
  radiusSm:   14,   // amenity tiles, small info cards
  radiusPill: 999,  // buttons, chips, badges
};

export default colors;
