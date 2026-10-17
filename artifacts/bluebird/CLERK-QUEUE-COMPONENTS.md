# Clerk-backed queue components

The reusable `ClerkQueuePanel` and hooks in `lib/useClerkQueue.ts` are an
isolated Mobile path. They use the currently selected Main API environment,
read the current Clerk session for each request, and pass requests through the
existing authenticated Main API client. They do not change the existing
`app/queue/*` legacy routes or local/demo queue mutations.

## Prepared Mobile per-flight contract

The typed Mobile client is prepared to call these environment-matched paths.
This records client expectations; it is not a claim of live compatibility:

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

## Main-source evidence and separate legacy API boundary

The supplied read-only audit of the separate Main Bluebird Website source
verifies the four per-flight route definitions, Clerk Bearer handling, and
Clerk-user-to-member mapping. It does not verify deployment, the selected
API/Clerk pairing, live token acceptance or identity resolution, or exact
deployed request/response compatibility with Mobile.

The workspace's `lib/api-spec/openapi.yaml` and API-server queue routes describe
a separate legacy `/api/queue/*` app-JWT contract. They neither disprove the
Main-source audit nor establish support on the selected Main deployment. Do not
send Clerk tokens to those legacy routes or substitute their member-wide queue
status for a per-flight Main queue read.

The queue hooks have an explicit fail-closed runtime evidence gate. It remains
disabled until all six requirements are verified: the audited Main service is
deployed at the selected target; its exact request/response contract matches
Mobile; the selected Main API/Clerk pairing is API-owner-confirmed; the live
server validates the selected Clerk token; the Clerk identity resolves to the
intended member at runtime; and the trusted existing-credit source is
established. Environment configuration, source evidence, and a signed-in Clerk
session alone do not activate queue reads or actions. Flight Details only
mounts the panel when the gate opens; while it is closed, it displays the
remaining gates and sends no queue requests.

`ClerkQueuePanel` and `useClerkQueue` are the only Main API Flight Details
integration. They never use local/demo queue operations. The audited Main
contract currently has only per-flight queue reads; it has no member-wide
waiting-queue listing endpoint for Clerk Trips. Do not synthesize a Trips list
by scanning public flights or substitute legacy member-wide queue data. No
request is sent while the gate is closed, and Main API errors do not trigger a
legacy fallback.

Skip the Line additionally requires an explicit confirmation, and all queue
mutations disable automatic retries so an ambiguous request is not resent.
These safeguards do not establish deployed endpoint support or live
functionality.
