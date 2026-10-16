# Bluebird queue API contract verification

**Reviewed:** 2026-10-16  
**Decision:** Keep the prepared Clerk queue panel out of Flight Details until the API-owner and credit-source evidence below is verified.

## Decision summary

The prepared Mobile client describes four per-flight operations under
`/api/empty-legs/{id}`, and the supplied contract snapshot documents them as
source-verified and Clerk-authenticated. However, the current checked-in
OpenAPI and API-server route mounts/handlers do **not** implement those paths.
They describe a different, legacy `/api/queue/*` API protected by this server's
own JWT secret, not Clerk token validation.

The supplied contract is documentation from 2026-10-12 and explicitly says
production runtime was not tested. Its queue entries cite
`artifacts/api-server/src/routes/queue.ts` as their source, but the current
checked-in file defines only the legacy queue routes listed below. Therefore
that source attribution does not establish that the per-flight routes exist in
the checked-in server or in any deployed service.

No live request was made. There is no API-owner confirmation in the available
evidence that the selected Development API matches the Clerk issuer, no
authorization for a specific non-sensitive read target, and no guarantee that
a queue response would contain no member data. No POST or DELETE was sent.

## Requested endpoint comparison

“Documented” below means described in the supplied contract snapshot, not
verified against a deployed service. “Clerk support” distinguishes that
documentation from the checked-in server and runtime evidence.

| Requested operation | Supplied contract | Checked-in OpenAPI and API server | Deployed existence | Clerk support / live verification |
| --- | --- | --- | --- | --- |
| `GET /api/empty-legs/{id}/queue` | **Described.** Public queue array; token may personalize `isViewer`. Contract says runtime not tested. | **Absent.** Neither the OpenAPI nor mounted route handlers define this per-flight path. | **Unverified.** No deployment/version evidence for a separate Main API was supplied. | Contract describes optional Clerk Bearer use; the checked-in server does not establish Clerk support. **Acceptance not live-verified.** No GET was sent. |
| `POST /api/empty-legs/{id}/queue` (Join Queue) | **Described.** Clerk Bearer required; returns a `QueueEntry`. | **Absent.** The checked-in server instead has `POST /api/queue/join`, with a different request/response contract. | **Unverified.** | Clerk auth is described by the snapshot only; not proven for a deployed API. **Acceptance not live-verified.** No POST was sent. |
| `DELETE /api/empty-legs/{id}/queue` (Leave Queue) | **Described.** Clerk Bearer required; returns a `QueueStatus`. | **Absent.** The checked-in server instead has `DELETE /api/queue/{id}` (entry ID, not flight ID). | **Unverified.** | Clerk auth is described by the snapshot only; not proven for a deployed API. **Acceptance not live-verified.** No DELETE was sent. |
| `POST /api/empty-legs/{id}/skip-line` (Skip the Line) | **Described.** Clerk Bearer required; `{ "useCredit": true }` spends an existing credit and returns an `EmptyLeg`. | **Absent.** The checked-in server instead has `POST /api/queue/{id}/use-pass` (queue-entry ID, not flight ID). | **Unverified.** | Clerk auth is described by the snapshot only; not proven for a deployed API. **Acceptance not live-verified.** No POST was sent. |

The Mobile client methods and hooks confirm only what the client is prepared to
call. `productionAuthApi.ts` builds the four paths and validates their expected
response shapes (lines 1351–1354, 1402–1448); `useClerkQueue.ts` obtains a
current Clerk session token and wires reads and mutations to those methods
(lines 17–49, 81–156). Neither proves that a server implements the paths.
The panel documentation itself says the paths and Clerk acceptance remain
unverified (`CLERK-QUEUE-COMPONENTS.md`, lines 41–54).

## Actual queue routes in the checked-in API

`app.ts` mounts the router at `/api` (lines 36–40), and `routes/index.ts`
mounts the queue router at `/queue` (lines 16–30). The current handler and
OpenAPI surface is:

| Checked-in operation | Route and behavior |
| --- | --- |
| Join | `POST /api/queue/join` — requires the legacy auth middleware; body includes `flightId` and other legacy join fields (`routes/queue.ts`, lines 53–90; OpenAPI, lines 740–765). |
| Read current user's queues | `GET /api/queue/status` — requires the legacy auth middleware and returns active entries for that user (`routes/queue.ts`, lines 336–352; OpenAPI, lines 767–782). |
| Leave/cancel | `DELETE /api/queue/{id}` — requires the legacy auth middleware and identifies a queue entry by its ID (`routes/queue.ts`, lines 419–455; OpenAPI, lines 784–809). |
| Use a Skip the Line pass | `POST /api/queue/{id}/use-pass` — requires the legacy auth middleware and identifies an existing queue entry (`routes/queue.ts`, lines 515–545; OpenAPI, lines 811–854). |

These routes are not aliases for the prepared per-flight operations. In
particular, do not send Clerk tokens to them and do not use them as a fallback.
The queue-status route returns member-specific entries, so it is not a safe
substitute for a public per-flight read.

## Authentication boundary and evidence limits

The checked-in middleware requires a Bearer token, verifies it with
`jsonwebtoken.verify(token, JWT_SECRET)`, and reads a local `userId` claim.
`JWT_SECRET` is taken from `JWT_SECRET` or `SESSION_SECRET`; the middleware
also checks its local revoked-token table (`artifacts/api-server/src/middlewares/auth.ts`,
lines 8–19 and 34–52). This source proves only the local app-JWT boundary. It
does not show Clerk JWKS/signature verification, issuer or audience validation,
or a Clerk `sub` to Bluebird-member mapping. Do not infer that a Clerk token
will pass it.

The supplied snapshot states that member requests use Clerk Bearer tokens, but
it also says it is documentation only, production runtime was **not** tested,
and the production Clerk instance parity is unknown
(`0_BLUEBIRD_MOBILE_PRODUCTION_API_CONTRACT_1791817009725.md`, lines 1–15).
Its per-flight queue entries say “VERIFIED FROM SOURCE; production runtime NO”
(lines 506–511, 556–561, 640–645, and 690–695). This is a source-derived
claim in the supplied document, not deployment evidence; its attribution to
the checked-in `routes/queue.ts` conflicts with the routes currently in that
file.

The readiness report likewise says the checked-in server does not prove Clerk
token compatibility and requires API-owner confirmation of issuer, verification,
claims, and identity mapping (`AUTHENTICATED-API-READINESS.md`, lines 502–517
and 1343–1355). Local client configuration and successful token acquisition do
not establish that the selected deployed server accepts that identity.

## Enablement decision

- **Join Queue:** cannot be enabled through the prepared Clerk panel today.
- **Leave Queue:** cannot be enabled through the prepared Clerk panel today.
- **Skip the Line:** cannot be enabled through the prepared Clerk panel today.
- **Flight Details:** cannot safely connect the prepared panel until the API
  owner confirms the deployed endpoint contract, the selected API/Clerk
  environment match, and the server's Clerk identity mapping.
- **Is backend work definitely required?** Not determined. If the intended
  service is this checked-in API server, its paths and authentication do not
  match the prepared client and backend/API contract work would be needed. A
  separate deployed Main API could implement the documented contract, but that
  is not established by the available evidence.

To resolve the remaining uncertainty, the API owner must provide authoritative
deployment/contract evidence and verify the selected Development API/Clerk
issuer pair. Any later live read requires explicit authorization for a
synthetic or empty target and assurance that its response cannot expose member
queue data. Until those conditions are met, deployed endpoint existence and
Clerk acceptance remain **unverified**.

## Scope and safety

This report is based on checked-in source, OpenAPI, and supplied documentation
only. No network request, queue read or mutation, token or user-data access,
database operation, or Main API/Clerk configuration change was performed.
Flight Details remains read-only and reports the missing verification. The
report contains no token, user identifier, or queue contents.
