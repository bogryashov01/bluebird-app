---
name: Metro platform facade resolution
description: Metro can choose a generic TypeScript source before a platform-specific TSX variant when extensions differ.
---

Keep extensionless imports backed by a declaration-only facade when native and web implementations use different source extensions. A generic runtime `.ts` re-export can win before `.native.tsx`/`.web.tsx` and pull browser-only dependencies into native bundles.

**Why:** Metro's source-extension ordering is not the same as TypeScript's platform-aware type-checking behavior; a runtime facade can therefore bypass the intended platform file and crash native startup.

**How to apply:** Use `Component.d.ts` for the shared type surface, keep platform-specific runtime files as `Component.native.tsx` and `Component.web.tsx`, and verify exported bundles/source maps for both native and web dependency isolation.