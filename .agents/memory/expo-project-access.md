---
name: Expo project access
description: Distinguishes an authenticated Expo integration from permission to read a specific EAS project's builds.
---

An authenticated Expo integration does not imply project-level EAS access. A build-list request that reaches Expo but returns `Entity Not Authorized` is a project permission problem; reconnecting is useful only if it selects an account that already has access or follows a project-access grant.

**Why:** Repeated OAuth reconnects authenticated the integration but did not add the selected accounts to the existing Bluebird EAS project.

**How to apply:** Before starting a paid build or submission, verify the configured project's existing builds through a read-only list call. If the project denies access, stop and have its owner grant build-read access to the exact connected account; do not create a replacement project or bypass authorization.
