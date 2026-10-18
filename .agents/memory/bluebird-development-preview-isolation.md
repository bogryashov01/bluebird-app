---
name: Bluebird development preview isolation
description: Architectural boundary for local Bluebird screen previews.
---

**Rule:** Route development previews through a root branch that renders fixture screens without mounting AuthProvider, ClerkProvider, or authenticated-data observers.

**Why:** Screen-level guards do not prevent providers and shared layout hooks from restoring sessions, reading tokens, or starting protected requests before the preview screen renders.

**How to apply:** When adding Bluebird preview screens, keep fixtures and navigation inside the isolated preview route tree; do not reuse production data hooks or authenticated components that mount them.
