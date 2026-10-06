---
name: Networking photo persistence
description: Decision and limitation for profile-photo storage in the mobile networking flow.
---

Account photos use an authenticated presigned upload to App Storage. The account holds the uploaded path; networking reads the same account photo rather than owning another image. API responses expose a stable serving URL for cross-device loading. Legacy HTTPS networking photos remain readable through an account-level URL fallback until replaced or removed; old data URIs are cleared by the schema migration.

**Why:** Expo can upload a native `expo-file-system` file through the storage presigned URL, avoiding database-sized base64 payloads while keeping the image available after the original device is gone. Both picker metadata and server-side object metadata enforce JPEG/PNG/WebP and the 1.5 MB limit. Preserving old HTTPS links instead of forcibly converting them avoids losing existing member pictures during the one-photo transition.

**How to apply:** Keep the upload URL route bearer-protected, persist new uploads only as normalized object paths, and resolve them through the API storage route. Never reintroduce a separate networking photo authority. Update the OpenAPI contract, generated client, mobile picker, schema, and server validation together when changing this flow.