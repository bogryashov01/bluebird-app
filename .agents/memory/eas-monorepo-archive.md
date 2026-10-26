---
name: EAS monorepo archive root
description: EAS archive and workspace-root behavior for Bluebird in the repository monorepo.
---

**Rule:** Run EAS commands from the Bluebird app directory, but treat the Git repository root as the source archive root. Workspace package-manager files at the repository root are included unless ignored; the app path is recorded relative to that root.

**Why:** EAS monorepo guidance requires commands from the app directory, while its project-upload rules and build job configuration root the archive at the VCS root. `eas build:inspect --stage archive` is local-only but still requires Expo account sign-in.

**How to apply:** Keep workspace lock/config/package-manager pins at the repository root, inspect the app path relative to the repo root, and distinguish an authentication-blocked archive inspection from an EAS build failure.
