---
name: Bluebird theming
description: How theming works in the Bluebird Expo app and rules for adding UI.
---

- Theme preference (Light/Dark/System) lives in ThemeContext (AsyncStorage-persisted); `useColors()` resolves the palette and exposes `scheme`.
- **Rule:** never hardcode color literals in screens/components — use tokens from `constants/colors.ts`. Key semantic tokens: `surface`/`textOnSurface`/`separator` for settings-style cards, `headerBackground`/`headerForeground` for nav chrome. `backgroundMid` is brand navy in BOTH modes (only for intentionally-branded surfaces like avatars/hero/auth splash).
- **Why:** light and dark palettes share token names; a literal renders wrong in one of the two modes.
- **How to apply:** colors go in inline style overrides, not StyleSheet.create, whenever they come from `useColors()`.
- Native (liquid-glass) tabs follow only the OS appearance; when the user forces Light/Dark, fall back to the themed classic tab bar.
