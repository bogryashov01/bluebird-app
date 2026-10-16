---
name: Pnpm release-age exceptions
description: How to handle trusted first-party releases blocked by the workspace's pnpm minimum-release-age policy.
---

Rule: Keep the workspace's minimum release-age safeguard enabled. If a task truly requires a fresh package from a trusted first-party publisher, use a narrow temporary `minimumReleaseAgeExclude` workspace allowlist entry and remove it immediately after installation.

**Why:** A pnpm CLI `--config.minimum-release-age-exclude` override appeared in `pnpm config get` but did not affect the dependency resolver during installation. The workspace-level allowlist did.

**How to apply:** Prefer waiting for the age window. If release timing blocks a required first-party compatibility update, allowlist only the necessary package(s) in `pnpm-workspace.yaml`, install, remove the exception, and verify the config diff is clean.
