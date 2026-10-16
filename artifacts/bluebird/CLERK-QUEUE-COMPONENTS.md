# Clerk-backed queue components

The reusable `ClerkQueuePanel` and hooks in `lib/useClerkQueue.ts` are an
isolated Mobile path. They use the currently selected Main API environment,
read the current Clerk session for each request, and pass requests through the
existing authenticated Main API client. They do not change the existing
`app/queue/*` routes, Flight Details, shared navigation, or the local/demo
queue mutations.

## Supported per-flight contract

The typed Main API client calls these environment-matched paths:

- `GET /api/empty-legs/{id}/queue` — public queue rows; the viewer is recognized
  only by exactly one response row with `isViewer: true`.
- `POST /api/empty-legs/{id}/queue` — joins and returns a `QueueEntry`.
- `DELETE /api/empty-legs/{id}/queue` — leaves and returns `QueueStatus`.
- `POST /api/empty-legs/{id}/skip-line` with `{ "useCredit": true }` — uses an
  existing credit and returns an `EmptyLeg`. The UI reports success only when
  the validated response identifies the viewer as the effective winner.

The client sends the Clerk token in `Authorization: Bearer …`, omits cookies,
and never sends checkout or payment fields. Join/leave/Skip the Line transition
results are checked against the requested leg and expected response state.
HTTP, token, network, and schema failures remain errors; the queue path does
not retry through or mutate the local/demo API.

Skip the Line callers must supply the existing credit count from authenticated
Main API data. The panel hides the action when that balance is zero; the server
still authoritatively rechecks available credit when the action is submitted.
The queue contract does not return a new credit balance, so the panel does not
guess one.

## Missing endpoints and auth boundary

There is no member-wide Main API queue list/status endpoint in the current
contract. The component can read one flight at a time only. Do not substitute
the local `GET /api/queue/status` response: it has a different shape and auth
contract.

The workspace's `lib/api-spec/openapi.yaml` and API-server queue routes describe
legacy `/api/queue/*` behavior. The API server's `authMiddleware` validates
tokens signed with the app's `JWT_SECRET`/`SESSION_SECRET`; it does not validate
Clerk tokens. That OpenAPI spec has no `/api/empty-legs/{id}/queue` or
`/api/empty-legs/{id}/skip-line` operations. Those paths exist in the separate
typed Main API client contract/readiness documentation, but this repo does not
establish that the deployed Main API accepts the selected Clerk token. A 401,
404, or other API rejection is displayed as a failure; it is not treated as
queue success and never triggers a demo fallback.

The Main API authentication readiness state also remains unavailable until
Clerk-token acceptance and stable member identity mapping have been verified.
This work prepares isolated components for later integration; it does not
activate that readiness gate or claim live queue requests succeed.
