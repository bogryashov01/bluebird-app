---
name: Bluebird development preview isolation
description: Architectural boundary for local Bluebird screen previews.
---

**Rule:** Preview screens must not mount active auth/session logic, Clerk, or authenticated-data observers. A stable inert AuthContext may cover the root route switch solely for transient auth layouts; Clerk sign-in must replace its screen before that switch.

**Why:** Expo Router can retain the outgoing route during root-stack transitions. Removing its provider at the same time can leave `useAuth()` layouts or Clerk-hook screens mounted without their context. Direct preview loads must still avoid session restoration and Clerk mounting.

**How to apply:** Keep fixture routes and navigation in the preview-only root branch. Use only an identity-free fallback AuthContext there, with no token restoration or auth actions. When launching Preview from a Clerk screen, replace that screen so it is not retained after Clerk unmounts. Verify direct loads and entry/back transitions separately.
