---
name: Clerk SMS preparation
description: Keep legacy Clerk phone sign-in creation separate from first-factor SMS preparation.
---

For the legacy Clerk phone OTP flow, create the sign-in attempt with `{ identifier }` only, then explicitly prepare the `phone_code` factor once using its selected `phoneNumberId`. Do not put `strategy: 'phone_code'` into create when the flow separately calls `prepareFirstFactor()`.

**Why:** Clerk's installed SDK sends create and first-factor preparation as distinct API actions, and its legacy docs describe the first-factor verification as empty until preparation. Including the strategy in create makes SMS side effects ambiguous and can lead to duplicate preparation when combined with the explicit step.

**How to apply:** When maintaining `@clerk/expo` legacy `useSignIn` phone-code flows, verify create parameters and keep request/resend actions synchronous single-flight at the UI boundary.
