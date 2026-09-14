---
name: Bluebird stack headers
description: Why Bluebird uses a custom AppHeader instead of the default native-stack header.
---

- All root-stack screens with `headerShown: true` render `components/AppHeader.tsx` via the shared `header:` option in `app/_layout.tsx`, not the default native-stack header.
- **Why:** the default header rendered behind the iPhone notch/Dynamic Island on screens pushed over the NativeTabs layout; AppHeader pads by `useSafeAreaInsets().top` (67px fixed on web, matching the app-wide web-inset convention).
- **How to apply:** when adding a new stack screen with a header, spread the shared `headerOptions` in `_layout.tsx`; don't reintroduce `headerStyle`/`headerTintColor` native options or per-screen `headerShown` toggles.
