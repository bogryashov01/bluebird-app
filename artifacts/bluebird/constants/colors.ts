/**
 * Bluebird design tokens — dark navy & electric blue palette
 * Derived from the Bluebird brand: #060B1F background, #1259F2 primary
 */

const colors = {
  light: {
    // ── Core surfaces ──────────────────────────────────────────────
    background:     '#060B1F',   // deepest dark — tab screens
    backgroundMid:  '#0A1128',   // headers, splash, confirmed screen
    card:           '#0D1636',   // elevated cards, discover rows
    cardHigh:       '#0F1B3D',   // modals, detail panels
    offWhite:       '#FAFAF8',   // light-surface screens (flight detail, profile, membership)

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
    mutedForeground:    '#8896B3',          // on dark surfaces
    mutedForegroundLight: 'rgba(10,17,40,0.45)', // on light (#FAFAF8) surfaces

    // ── Accent ────────────────────────────────────────────────────
    accent:            '#1259F2',
    accentForeground:  '#FFFFFF',

    // ── Status ────────────────────────────────────────────────────
    success:            '#1E9E5C',
    successForeground:  '#FFFFFF',
    destructive:        '#FF3B30',
    destructiveForeground: '#FFFFFF',
    coral:              '#FFB199',          // alert / warm accent

    // ── Borders & inputs ──────────────────────────────────────────
    border: '#1E2D4F',
    input:  '#1A2744',

    // ── Legacy aliases ────────────────────────────────────────────
    text: '#FFFFFF',
    tint: '#1259F2',
  },

  dark: {
    background:     '#060B1F',
    backgroundMid:  '#0A1128',
    card:           '#0D1636',
    cardHigh:       '#0F1B3D',
    offWhite:       '#FAFAF8',
    foreground:     '#FFFFFF',
    cardForeground: '#FFFFFF',
    primary:            '#1259F2',
    primaryForeground:  '#FFFFFF',
    paleBlue:       '#7FA8FA',
    paleBlueFaint:  '#BFD3FB',
    secondary:          '#1A2744',
    secondaryForeground:'#FFFFFF',
    muted:              '#1A2744',
    mutedForeground:    '#8896B3',
    mutedForegroundLight: 'rgba(10,17,40,0.45)',
    accent:            '#1259F2',
    accentForeground:  '#FFFFFF',
    success:            '#1E9E5C',
    successForeground:  '#FFFFFF',
    destructive:        '#FF3B30',
    destructiveForeground: '#FFFFFF',
    coral:              '#FFB199',
    border: '#1E2D4F',
    input:  '#1A2744',
    text:   '#FFFFFF',
    tint:   '#1259F2',
  },

  // ── Radius scale ────────────────────────────────────────────────
  radius:     18,   // standard cards
  radiusLg:   24,   // featured cards, hero overlays
  radiusSm:   14,   // amenity tiles, small info cards
  radiusPill: 999,  // buttons, chips, badges
};

export default colors;
