---
name: Main API environment isolation
description: Safety rule for selecting Bluebird mobile Main API and Clerk environments.
---

Every Main API client must use an explicit selected environment, that environment's configured API URL, and its matching Clerk instance. Do not infer Production from a hostname, fall back to the local API, or reuse legacy Clerk/JWT configuration. Bind fresh-token providers and authenticated cache keys to the same environment.

**Why:** A valid Clerk token sent to the wrong API or account environment can cross identity boundaries. The local generated client has a separate JWT/session contract and is not a safe fallback.

**How to apply:** When migrating a mobile feature, construct the shared integration from the selected validated configuration; keep unsupported operations on their existing isolated path until an approved contract exists.

Bluebird Mobile is a client of the Main Bluebird Website's Clerk identity, profiles, registration, memberships, and Main API. Do not create a second user database or use the legacy mobile demo backend to fill gaps in this account flow.

**Why:** The product owner stated that the Main Website owns the user account and membership systems; phone/email similarity alone does not authorize linking or creating another account.

**How to apply:** For Clerk account and profile work in Bluebird Mobile, use only the documented Main API operations and keep unsupported account/member capabilities closed rather than introducing local account storage or legacy-backend fallback.

For cross-service connection probes, keep the action disabled until an API-owner-verified, non-secret issuer (or equivalent API-side instance identifier) is explicitly compared with the selected Clerk instance. A `pk_test_` prefix, hostname naming pattern, or guest-shaped HTTP 200 is not match evidence.

**Why:** Environment markers and response success do not establish which Clerk tenant verifies a token; `/api/me` can return an anonymous projection.

**How to apply:** Validate the API-side issuer against the selected Clerk instance before asking for a token or sending a request. Keep configuration diagnostics value-free and do not probe the API to discover its identity.

Source evidence from the separate Main Website must stay scoped to the audited source: route definitions, Clerk Bearer handling, and identity-mapping code do not prove deployment, live token acceptance, or Mobile response compatibility. The workspace's app-JWT API is a different service and is never a substitute or fallback.

**Why:** A newer read-only Main-source audit confirmed those implementation facts while deployment and runtime behavior remained unverified; treating the local legacy API as representative would incorrectly reject the Main contract.

**How to apply:** In Mobile queue readiness reports, distinguish supplied Main-source facts, Mobile client preparation, and authorized runtime checks. Keep queue traffic gated until the selected deployed pair and its live behavior are confirmed.
