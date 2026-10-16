# Bluebird queue API evidence and readiness

**Reviewed:** 2026-10-16  
**Decision:** Keep the prepared Clerk queue panel out of Flight Details. Main-source existence, Mobile client preparation, deployment, and runtime acceptance are separate evidence claims.

## Evidence summary

The supplied read-only audit was performed in the separate Main Bluebird Website source. It verifies that this source contains:

- `GET /api/empty-legs/:id/queue`
- `POST /api/empty-legs/:id/queue`
- `DELETE /api/empty-legs/:id/queue`
- `POST /api/empty-legs/:id/skip-line`
- Clerk Bearer-token handling for member requests
- Clerk user ID to `members.clerk_user_id` mapping

That audit does **not** prove that the audited source is deployed at Mobile's selected target, that the live service accepts a token from the selected Clerk instance, or that the deployed request/response shapes match Mobile's parsers. The report below treats the supplied audit as evidence of those Main-source facts, not as runtime verification.

Mobile source independently verifies that it:

- selects one explicit Main API environment and that environment's API/Clerk settings; it ignores legacy API/Clerk defaults;
- prepares the four per-flight requests with Clerk Bearer authentication and parses expected queue response shapes;
- routes them through the isolated `ClerkQueuePanel` / `useClerkQueue` path, which has no local/demo API adapter;
- keeps reads and mutations disabled until every runtime gate is explicitly verified.

These Mobile facts prove client preparation, not server support or live compatibility.

## Safe Mobile environment assessment

The current value-free Development diagnostic reports: Development is selected; the Development API setting and Clerk test-key setting are present and structurally valid; Clerk auth is enabled; the configured issuer host matches the host encoded in the configured Clerk key; and the diagnostic's `canTest` status is true.

This is a configuration-shape check only. It prints no URL, key, issuer, token, or account data. The host comparison does not establish that the configured issuer came from the API owner, that this API target is the audited Main deployment, or that its server validates this Clerk tenant. No environment setting was changed and no network request was made.

## Mobile contract prepared for the four operations

| Operation | Mobile client expectation | Main-source audit | Deployment / live compatibility |
| --- | --- | --- | --- |
| Queue Position: `GET /api/empty-legs/{id}/queue` | Parses public queue rows; identifies the viewer only when exactly one row has `isViewer: true`. | Route exists in Main source; Clerk Bearer handling and identity mapping are source-verified. | Deployment, exact response compatibility, privacy of the live response, Clerk acceptance, and correct viewer resolution are unverified. |
| Join Queue: `POST /api/empty-legs/{id}/queue` | Sends the optional typed join body and expects a `QueueEntry` confirming the requested flight and a valid position. | Route exists in Main source; Clerk Bearer handling and identity mapping are source-verified. | Deployment, exact request/response compatibility, live Clerk acceptance, eligibility/result behavior, and correct member resolution are unverified. |
| Leave Queue: `DELETE /api/empty-legs/{id}/queue` | Expects a `QueueStatus` confirming the requested flight and `userInQueue: false`. | Route exists in Main source; Clerk Bearer handling and identity mapping are source-verified. | Deployment, exact response compatibility, live Clerk acceptance, and correct member resolution are unverified. |
| Credit-based Skip the Line: `POST /api/empty-legs/{id}/skip-line` | Sends only `{ "useCredit": true }`, requires explicit user confirmation and a positive existing credit count, and expects a validated `EmptyLeg` identifying the viewer as effective winner. | Route exists in Main source; Clerk Bearer handling and identity mapping are source-verified. | Deployment, exact request/response compatibility, live Clerk acceptance, correct member resolution, and a trusted existing-credit source are unverified. |

## Separate checked-in legacy API

This workspace also contains a separate legacy API contract under `/api/queue/*`, protected by its app-JWT middleware. It is not the separate Main Website source audited above. Its different routes, token contract, and member-wide queue response neither disprove Main-source support nor establish Main deployment or compatibility.

Do not send Clerk tokens to the legacy routes, substitute their member-specific status response for a per-flight Main read, or fall back to them on any Main API error. The Clerk queue adapter has no legacy-JWT or local/demo queue access.

## Current gates and Flight Details behavior

Queue reads and actions remain disabled until all of these are verified for the actual selected service:

1. The Main service covered by the audit is deployed at the selected target.
2. Its exact live request/response contract is compatible with Mobile's expected shapes and transition checks.
3. The selected Main API and Clerk issuer pairing is API-owner-confirmed.
4. The live server accepts and validates the selected Clerk Bearer token.
5. The Clerk user resolves at runtime to the intended Bluebird member.
6. The source of the existing Skip the Line credit balance is trusted and matches the server's authoritative check.

The supplied Main-source audit satisfies only source-existence, Clerk Bearer-handling, and identity-mapping-exists evidence. It does not satisfy any of the six runtime gates. Flight Details therefore keeps its read-only notice and does not mount the Clerk panel or make Main queue reads or mutations. The existing `ClerkQueuePanel` and hooks remain the only planned integration path; no endpoint or duplicate queue implementation was added.

The existing client safeguards remain required after enablement: mutation retries are disabled; Skip the Line requires explicit confirmation and an existing credit; a success message requires a validated server transition; failures do not fall back to local/demo behavior.

## Smallest remaining authorized verification

Use only an API-owner-approved Development target, a disposable synthetic member, and an isolated test flight/queue. The API owner must first confirm that the target is the audited Main deployment, provide the authoritative Development issuer identity, and confirm that a queue read cannot expose unrelated member data. Compare the deployed OpenAPI/route contract and real responses with the Mobile parsers before considering any action. Do not test by mutating Production.

- **Queue Position:** confirm the selected API/Clerk pairing, live Clerk validation, and runtime member mapping; obtain approval for a safe read; verify the live public-row schema and that the intended test member is represented only by the expected viewer marker.
- **Join Queue:** after the read gates above, verify the live POST body/response against Mobile's parser using only an owner-approved disposable Development member and test flight; confirm the response identifies that flight and a valid joined position.
- **Leave Queue:** verify the live DELETE response against Mobile's parser using only that Development test member's disposable queue entry; confirm the server reports the member out of the queue.
- **Credit-based Skip the Line:** first verify the trusted Development credit source against the server's balance; then, only with an explicit test approval and disposable existing credit, verify the `{ "useCredit": true }` request and that the response confirms the intended member as effective winner.

Do not run these live checks until explicitly authorized. A publishable-key prefix, successful local token acquisition, source code, or the diagnostic's `canTest` status is not authorization or proof of deployed behavior.

## Scope and safety record

This reconciliation used the supplied Main-source audit, Mobile source, and a value-free local configuration diagnostic only. No network request, queue read or mutation, token or account-data access, database operation, or API/Clerk/environment change was performed. The local legacy API remains a distinct app-JWT contract and is never a fallback.
