---
name: Stale composite TS builds
description: Phantom "no exported member" / missing-property type errors come from stale lib dist + tsbuildinfo.
---

**Rule:** When app typechecks report missing exports or missing fields that clearly exist in a `lib/*` package's source (e.g. `useGetFlightMyStatus`, a new schema column), the lib's `dist/` + `tsconfig.tsbuildinfo` are stale. Fix with `pnpm exec tsc -b lib/<pkg>` (or all libs) before assuming real errors — and rebuild `lib/db` after any schema change.

**Why:** Libs are composite projects emitting declarations to `dist/`; consumers resolve types from there, so edits to `src/` don't propagate until rebuilt. This masqueraded as "pre-existing type errors blocking mobile builds."

**How to apply:** After editing any `lib/*` source or seeing implausible cross-package type errors, run `tsc -b` on the affected libs, then re-run the consumer's typecheck.
