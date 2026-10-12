---
name: Clerk Expo SDK 54 peer compatibility
description: Clerk Expo's broad SDK peer range can hide incompatible React peer ranges in its transitive packages.
---

Rule: Before adding Clerk Expo to Bluebird's Expo 54 app, inspect the full resolved dependency graph, not only `@clerk/expo`'s declared peers. Expo 54 pins React 19.1.0; Clerk subpackages can require a later 19.1 patch even when the SDK's top-level peer range accepts `^19`. Do not accept a graph that only emits peer warnings.

**Why:** pnpm's current resolver completed both the latest Expo-compatible Clerk graph and an older Expo-54-range graph, but each selected transitive Clerk packages whose React peer ranges excluded Bluebird's pinned 19.1.0. The workspace allows peer warnings, so a successful resolution alone is not a compatibility result.

**How to apply:** Re-check current Expo, React, Clerk Expo, and every resolved Clerk package before adding dependencies in a future activation. Proceed only when all direct and transitive peers match under the unchanged workspace policy, without overrides, forced installs, policy bypasses, or out-of-scope React/Expo changes.
