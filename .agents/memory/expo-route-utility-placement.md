---
name: Expo route utility placement
description: Shared mobile helpers must live outside the Expo Router app tree.
---

Expo Router treats every file under the mobile app directory as a potential route. Shared non-screen modules belong outside that directory, such as the app's library folder.

**Why:** A pure helper placed beside a dynamic screen produced a missing-default-export route warning in the web preview even though the app still loaded.

**How to apply:** Keep reusable helpers, types, and testable domain logic outside the route tree; import them into screens through the app alias.
