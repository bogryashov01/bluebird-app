---
name: Networking photo persistence
description: Decision and limitation for profile-photo storage in the mobile networking flow.
---

Networking profile photos currently use validated HTTPS URLs or size-limited image data URIs stored with the profile. This keeps Expo profile editing functional without introducing a web-only object-storage client; the server enforces image format and a 1.5 MB decoded-size limit.

**Why:** The available object-storage guidance targets web uploads, while this feature needs an Expo-compatible path and must not retain a local-only image URI.

**How to apply:** Keep photo values portable across sessions/devices and preserve server-side validation. Move to App Storage only when an Expo-compatible upload path is available, updating both the API contract and mobile picker flow together.