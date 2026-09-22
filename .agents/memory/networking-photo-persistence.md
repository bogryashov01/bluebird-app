---
name: Networking photo persistence
description: Decision and limitation for profile-photo storage in the mobile networking flow.
---

Networking profile photos use an authenticated presigned upload to App Storage. The profile stores the returned `/objects/uploads/...` path in `photo_asset_path`, while API responses expose a stable `/api/storage/objects/...` URL for cross-device loading. Legacy HTTPS photos remain readable; old data URIs are cleared by the schema migration.

**Why:** Expo can upload a native `expo-file-system` file through the storage presigned URL, avoiding database-sized base64 payloads while keeping the image available after the original device is gone. Both picker metadata and server-side object metadata enforce JPEG/PNG/WebP and the 1.5 MB limit.

**How to apply:** Keep the upload URL route bearer-protected, persist only the normalized object path, and resolve it through the API storage route. Update the OpenAPI contract, generated client, mobile picker, schema, and server validation together when changing this flow.