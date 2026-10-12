---
name: Clerk Expo SDK 54 peer compatibility
description: Clerk Expo's broad SDK peer range can hide incompatible React peer ranges in its transitive packages.
---

Rule: Before adding Clerk Expo to Bluebird's Expo 54 app, inspect the full resolved dependency graph, not only `@clerk/expo`'s declared peers. Expo 54 pins React 19.1.0; newer Clerk React/shared packages may require a later React 19.1 patch and reject that baseline. If compatible older packages are blocked by the workspace package firewall, stop and report the blocker rather than bypassing the firewall or forcing React/peer overrides.

**Why:** Clerk's Expo package metadata advertised Expo 54 support while the transitive React peers excluded Bluebird's pinned React. An older Clerk dependency graph matched the peer range but its older shared package was denied by the package firewall.

**How to apply:** Re-check current Expo, React, Clerk Expo, and every resolved Clerk package before adding dependencies in the future Clerk activation stage. Proceed only when the package manager resolves a compatible graph without firewall bypasses or out-of-scope React changes.
