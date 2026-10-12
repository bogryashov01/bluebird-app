---
name: Clerk Expo baseline compatibility
description: Clerk Expo peer compatibility requires checking the full graph and the Expo baseline's native runtime risks.
---

Rule: Before adding Clerk Expo to Bluebird, inspect the full resolved dependency graph, not only `@clerk/expo`'s declared peers. A baseline that satisfies Clerk's React peers may still have runtime regressions in its native modules; check Expo's module map and release notes as well. For Bluebird, SDK 57.0.17+ is the baseline with Expo's fix for the SDK 56 Hermes V1/Reanimated/Worklets memory regression.

**Why:** pnpm resolved Clerk transitive packages whose peer ranges excluded Expo 54's React 19.1.0, while Expo 56's React 19.2.3 satisfies those peers but Expo documents a Hermes memory regression affecting Reanimated/Worklets. Expo's SDK 57 release notes identify the later SDK line as fixing that regression.

**How to apply:** Re-check Expo, React, Expo Router, every resolved Clerk package, the SDK-bundled native modules, and release-note regressions before selecting an upgrade. Require typechecks and native development-build/performance verification; Metro exports alone are insufficient. Keep the package policy unchanged and use no peer overrides or forced installs. Expo 57 moved native splash configuration to the `expo-splash-screen` plugin; keep PWA splash settings under `web.splash`.
