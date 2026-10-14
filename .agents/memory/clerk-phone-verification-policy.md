---
name: Clerk phone verification policy
description: Bluebird's supplied Development Clerk settings allow sign-up without requiring phone verification.
---

Rule: Treat the supplied Development-instance report that sign-up verification is disabled as an unresolved account-security policy, not proof that a submitted phone is verified. Gate any phone-ownership-dependent behavior on Clerk's actual verification state and an owner-approved policy.

**Why:** A completed sign-up or active session does not by itself establish phone ownership when verification-at-sign-up is disabled.

**How to apply:** Before enabling Clerk phone sign-up or granting member access based on a phone number, confirm the current instance setting and the product/security decision; never infer verification from the screen flow or session state.
