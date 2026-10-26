---
name: Replit Publish Expo auth
description: Separates the personal Expo connector session from Replit's managed mobile Publishing/Launch authentication.
---

A successful read-only query through the connected Expo personal integration does not prove that Replit's managed Publishing/Launch session is valid or authorized for the same EAS project. Treat them as separate authentication contexts unless Replit provides evidence that they share a principal/session.

**Why:** The workspace exposes the personal Expo integration but not Replit's internal Publish session or request-level diagnostics; Preview's `create-launch login` is not evidence about Publish authentication.

**How to apply:** For `EXPO_UNAUTHORIZED`, inspect the Publishing tool's own logs and ask Replit Support to identify the managed principal and failing stage. Do not recommend reconnecting the personal Expo integration as a Publish-session fix without verified evidence.
