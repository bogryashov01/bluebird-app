# Bluebird Connections and Messaging: Mobile Implementation Readiness

**Audit date:** 2026-10-26  
**Scope:** Static, read-only inspection of the checked-in Bluebird Expo app, the separate checked-in API Server artifact, workspace OpenAPI/Zod output, and Drizzle schema/migrations. No routes were called, no database was opened or changed, and no messages, requests, pushes, deployments, or Git operations were performed.

## Executive summary

The repository contains a working **local API Server implementation** for flight introductions, incoming request decisions, accepted connections, one-to-one messages, profile data, blocking/reporting, notification records, and best-effort Expo push delivery. The Expo app contains screens for the same local flows, and the checked-in OpenAPI and generated Zod models describe the local networking operations.

This does **not** establish readiness for the main Bluebird website or its production backend. Those sources and runtime are unavailable in this workspace. The existing mobile cleanup audit records that its supplied Main API contract snapshot (dated 2026-10-12) did not include networking operations and that production behavior was not runtime-tested. The local API Server, its local JWT middleware, and its generated contract must not be treated as evidence that the Main API accepts the same routes or tokens. See [evidence and boundaries](#1-evidence-and-boundaries).

For the Expo app, the current networking screens use `@workspace/api-client-react` and the legacy Bluebird JWT. They are available in the legacy/local flow, but the Clerk member route gates keep ordinary member screens unavailable until authoritative member resolution is enabled. The dedicated Connections route is hidden from the tab bar; Profile shortcuts and the flight-detail introduction affordance provide entry points. The current UI is therefore reusable, but it is not wired to a verified production networking contract.

**Readiness verdict:** Local/demo implementation is present and source-verifiable. Production integration is **blocked** pending a production API contract and owner verification of authentication, member eligibility, data policy, and notification behavior. The estimates below assume those blockers are resolved first.

## 1. Evidence and boundaries

### What was inspected

- Mobile routes and navigation: `artifacts/bluebird/app/(tabs)/connections.tsx`, `app/networking/*`, `app/flight/[id].tsx`, `app/account/personal-info.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/profile/index.tsx`, `app/_layout.tsx`, and `context/AuthContext.tsx`.
- Notification routing and checked-in tests: `lib/notificationRoute.ts`, `tests/networking-samples.spec.mjs`, `tests/networking-notifications.spec.mjs`, `tests/networking-social-links.spec.mjs`, and `tests/profile-photo.spec.mjs`.
- Local API Server: `artifacts/api-server/src/routes/networking.ts`, `routes/storage.ts`, `routes/index.ts`, and `middlewares/auth.ts`.
- Workspace API contract and generated models: `lib/api-spec/openapi.yaml` and `lib/api-zod/src/generated/api.ts`.
- Data models and DDL: `lib/db/src/schema/index.ts` and `lib/db/src/migrate.ts`.
- Existing boundary documentation: `artifacts/bluebird/BLUEBIRD-MOBILE-CLEANUP-MAP.md`.

### Evidence labels and unknowns

- **Checked-in source fact** means the statement follows from the files listed in this report. It describes implementation, not a live service.
- **Checked-in contract fact** means the workspace OpenAPI or generated schema declares the shape. It does not prove that a deployed server implements it.
- **Unknown** means the website source, production backend implementation, production data, or deployed behavior was not available for this audit.

For brevity, mobile citations beginning with `app/`, `context/`, `lib/`, or `tests/` are relative to `artifacts/bluebird`. API citations beginning with `networking.ts`, `storage.ts`, `routes/index.ts`, or `middlewares/auth.ts` resolve under `artifacts/api-server/src`; `schema/index.ts` and `migrate.ts` resolve under `lib/db/src`. The source reference index gives full repository paths.

The main Bluebird website repository and production backend source were not available for inspection. No production endpoint, account, conversation, deployment, or push delivery was tested. The local API Server is a separate artifact registered at `artifacts/api-server`; `routes/index.ts` mounts its `networking` router at `/api/networking` (`artifacts/api-server/src/routes/index.ts:13-30`). Its code is not the website's backend source.

The workspace OpenAPI (`lib/api-spec/openapi.yaml:1-9, 525-738`) and generated Zod models (`lib/api-zod/src/generated/api.ts:508-780`) do include local networking operations. This is distinct from the Main API production-contract assessment recorded in the existing cleanup map: it explicitly lists networking among the unsupported Main API feature families and says the production contract/runtime is not verified (`artifacts/bluebird/BLUEBIRD-MOBILE-CLEANUP-MAP.md:3-5, 44-56, 115`). Treat that document as a checked-in record of a supplied contract snapshot, not as access to the website or proof of current production behavior.

## 2. Current mobile functionality and restrictions

### User flows present in source

1. **Flight introduction:** Flight detail conditionally loads the front-of-queue member only in `localReadMode`, with a signed-in legacy user and a paid tier; it refreshes every 15 seconds. The requester enters a message and sends `POST /api/networking/requests`. Membership-required errors route to plan selection; other errors are displayed in the flight screen (`app/flight/[id].tsx:212-230, 290-304`). The server restricts eligibility to the position-one waiting member on an available flight and returns a minimal profile preview (`api-server/src/routes/networking.ts:435-463`).
2. **Incoming requests:** The Connections hub links to the incoming-request screen. It loads on mount, shows a loading state, a retryable load error, and an empty state. Each request shows the requester's first name/industry, intro text, and flight summary, with Accept, Decline, Remove, Block, and Report actions (`app/(tabs)/connections.tsx:196-209`; `app/networking/requests.tsx:12-59`). The screen invalidates incoming requests and connections after success; it does not provide an outgoing-request list. Its actions have no per-action error feedback handler in this screen.
3. **Accepted connections and messages:** The hub has Connections and Messages views. Both are backed by the same accepted-connections query; Messages sorts those connections by `lastMessage.createdAt` and also displays accepted connections with no messages yet (`app/(tabs)/connections.tsx:34-38, 72-79, 117-144, 249-309`). Selecting a card opens the thread.
4. **Conversation:** The thread loads messages, refreshes on focus and every 10 seconds, separately polls connections every 15 seconds for profile/social data, supports a multiline message up to 1,000 characters, and invalidates the thread and connection list on send success (`app/networking/connections/[id].tsx:18-24, 42-60, 79-92`). It displays loading, retryable error, empty-conversation, and send-error states. It has a direct Block action without a confirmation step. Social links are only rendered for a loaded accepted connection and are restricted client-side to HTTP(S) URLs without embedded credentials before `Linking.openURL` (`app/networking/connections/[id].tsx:25-40, 65-78`).
5. **Networking profile:** The old `/networking/profile` route is only a compatibility redirect to `/account/personal-info` (`app/networking/profile.tsx:4-13`). That account screen keeps the networking profile separate from account name/email/weight. In the legacy local flow, a paid member can edit first/last name, industry, bio, and optional LinkedIn/Facebook/Instagram URLs. It displays completion/missing fields and retries load failures (`app/account/personal-info.tsx:606-632, 811-843, 1010-1072`). The profile photo is the account photo, uploaded through the authenticated storage upload flow and then saved to the account; the networking text save does not write the photo (`app/account/personal-info.tsx:619-632, 714-785`; `api-server/src/routes/storage.ts:15-44`).
6. **Notifications:** The in-app notification list marks unread items read when pressed, then routes networking requests/declines to Requests, accepted/message notifications with a connection ID to the conversation, and missing-ID or unrecognized notifications to the Messages inbox (`app/notifications.tsx:401-405`; `lib/notificationRoute.ts:1-25`). Profile contains Connections, Messages, and Connection Requests shortcuts (`app/(tabs)/profile/index.tsx:520-529`).

The checked-in Playwright tests encode these journeys using mocked API responses or the configured development sample flow. They cover request handling, accepted and empty conversations, notification destinations, shortcuts, and visibility of social links (`tests/networking-samples.spec.mjs:62-124`; `tests/networking-notifications.spec.mjs:103-258`; `tests/networking-social-links.spec.mjs:12-63`). These tests are source evidence for intended UI behavior, not evidence of production operation. They were not run during this read-only audit.

### Navigation and availability limits

- Connections is a hidden route in the classic tab layout, not a bottom-tab item (`app/(tabs)/_layout.tsx:133-153`). Profile shortcuts are its visible in-app navigation (`app/(tabs)/profile/index.tsx:520-529`).
- The Development full-app demo stack does not register the networking routes, and its Profile shortcuts are disabled in demo mode (`app/_layout.tsx:352-404`; `app/(tabs)/profile/index.tsx:520-529`). Separately, the Connections hub has a `__DEV__`-only “Restore sample data” panel; its sample mutation invalidates connections and incoming requests (`app/(tabs)/connections.tsx:60-70, 211-246`).
- In Clerk mode, the root and tab guards require member resolution before member routes are exposed. The tab layout redirects an unresolved signed-in Clerk session to the pending signed-in screen (`app/_layout.tsx:71-90`; `app/(tabs)/_layout.tsx:182-195`). The existing cleanup map also records that production authenticated member routes are intentionally unavailable and the current Clerk resolution does not establish an authoritative Bluebird member ID (`BLUEBIRD-MOBILE-CLEANUP-MAP.md:21-23, 40-42, 147-151`).
- The flight introduction and profile editor explicitly use the legacy/local flow. The hub, requests, and conversation directly use generated local API hooks (`app/(tabs)/connections.tsx:15-19, 34-38`; `app/networking/requests.tsx:3-17`; `app/networking/connections/[id].tsx:3-9`). The checked-in mobile cleanup map lists networking among the generated-client/legacy JWT consumers, not among supported Main API features (`BLUEBIRD-MOBILE-CLEANUP-MAP.md:44-52, 115`).
- Request list screen has no polling or focus-refresh hook; it refetches on mount. The hub polls connections every 15 seconds and refreshes on focus/pull-to-refresh. The conversation polls messages every 10 seconds and connections every 15 seconds. These are periodic HTTP reads, not a real-time stream.

### UI features not present

There is no outbound-request screen/list; member search or discovery independent of a shared flight; request cancellation; connection removal/unblock; report action from an established thread; moderation review UI; message edit/delete, pagination, search, attachments, reactions, typing/read receipts, group conversations, or delivery status in the inspected route implementation. There is no live socket/SSE messaging route in the checked-in networking router. The current “Messages” view is a connection list with previews, not a separate inbox endpoint.

## 3. Local API and contract inventory

All paths below are under `/api`. Every route in `networking.ts` inherits `authMiddleware` from `router.use(authMiddleware)` (`artifacts/api-server/src/routes/networking.ts:22-23`). The middleware requires a Bearer token that verifies with this server's configured JWT secret, checks its revocation hash, and assigns the token's `userId` (`artifacts/api-server/src/middlewares/auth.ts:8-16, 18-52`). This is the local Bluebird JWT scheme. It is **not** proof that a Clerk token works on the local server or that either token works on the Main API.

Unless noted otherwise, member-facing routes also call `memberRequired`, which returns 403 with code `MEMBERSHIP_REQUIRED` for a missing user or tier `none` (`networking.ts:36-45`). The route handlers' runtime errors below are taken from source; the OpenAPI response declarations are not exhaustive for every handler status.

| Method and path | Auth / inputs | Success response | Side effects | Errors observed in checked-in handler |
|---|---|---|---|---|
| `GET /networking/profile` | Bearer local JWT; paid membership. No parameters. | `200` profile fields plus `completed` and `missing`. | **Read may create:** inserts a default networking profile from the account name when none exists (`networking.ts:206-224`). | `401` invalid/expired auth; `403` membership; `500` load failure. |
| `PATCH /networking/profile` | Bearer JWT; paid membership. JSON optional fields: first/last name (1–80 after trim), industry (1–80), bio (1–280), social URLs or null, `photoAssetPath` or legacy `photoUrl`. | `200` saved profile plus completion fields. | Transactionally upserts profile; photo writes update account-level photo and upload ownership/status, and schedule cleanup for replaced uploads (`networking.ts:230-413`). | `400` invalid field/URL/path, photo metadata/type/size/not-found/ownership, empty update; `401` authenticated user record missing; `403` membership; `500` save failure. |
| `POST /networking/push-tokens` | Bearer JWT; **no paid-tier gate**. Body `{token: string, platform?: string}`. | `200` saved token row `{id,userId,token,platform,createdAt,lastUsedAt}`. | Upserts by globally unique token; reassigns token to the current user on conflict. | `401` invalid/expired auth; `400` empty or over-512-character token; `500` registration failure. |
| `GET /networking/flights/{flightId}/front-member` | Bearer JWT; paid membership. Path `flightId`. | `200` `{eligible:false,member:null}` or eligible flight and limited member preview. | Read-only. Eligible only for another member at position 1 on an available flight, with complete profile and no block in either direction (`networking.ts:435-459`). | `401` auth; `403` membership; `404` flight missing; `500` lookup failure. |
| `POST /networking/requests` | Bearer JWT; paid membership. Body `{flightId:string,message:string}`; trimmed message length 1–240. | `201` new request with requester preview; `200` when reopening an existing non-pending/non-accepted row (normally declined; the current ignore action deletes its row). | Inserts or reopens request; creates in-app notification and attempts Expo push for recipient (`networking.ts:465-517`). | `400` invalid request or incomplete profile (`NETWORKING_PROFILE_INCOMPLETE`); `403` membership or blocked member; `409` no eligible position-one member, flight unavailable, or pending/accepted duplicate; `500` send failure. |
| `GET /networking/requests/incoming` | Bearer JWT; paid membership. No parameters. | `200` array of pending requests with requester preview and flight city/date. | Read-only; ordered newest first. | `401` auth; `403` membership; `500` load failure. |
| `POST /networking/requests/{id}/decision` | Bearer JWT; paid membership. Path `id`; body `{action:accept|decline|ignore|block|report, reason?:string}` (reason trimmed/truncated to 500). | `200` status; accept includes connection identity. | `ignore` deletes request; `block` inserts block; `report` stores a report and reason; `decline` changes state and notifies requester; `accept` marks accepted, creates/reuses a connection and notifies requester (`networking.ts:541-594`). | `400` unsupported action; `401` auth; `403` membership or blocked relationship on accept; `404` request not found/not addressed to caller; `409` already-decided request or connection creation failure; `500` decision failure. |
| `GET /networking/connections` | Bearer JWT; paid membership. No parameters. | `200` accepted connections with the other member's full public networking profile and last-message preview. | Read-only; omits connections where either participant blocked the other; newest connection first. | `401` auth; `403` membership; `500` load failure. |
| `GET /networking/connections/{id}/messages` | Bearer JWT; paid membership. Path `id`. | `200` all messages for that connection, oldest first. | Read-only; returns the full history with no pagination parameters. | `401` auth; `403` membership, non-participant/missing connection, or blocked relationship; `500` load failure. |
| `POST /networking/connections/{id}/messages` | Bearer JWT; paid membership. Path `id`; body `{content:string,clientMessageId?:string}`; trimmed content 1–1,000 chars, client ID at most 100. | `201` new message; `200` existing message when same sender/client ID is retried. | Inserts message; creates in-app recipient notification and attempts Expo push (`networking.ts:642-669`). | `400` empty/too-long message; `401` auth; `403` membership, non-participant/missing connection, or blocked relationship; `500` send failure. |
| `POST /networking/connections/{id}/block` | Bearer JWT; paid membership. Path `id`; no body. | `200` `{blocked:true}`. | Inserts a directed block, idempotently. Existing connection row is not deleted; future reads hide it and message access is rejected due to the block check (`networking.ts:671-684`). | `401` auth; `403` membership; `404` connection missing or caller is not a participant; `500` block failure. |

### Contract status and gaps

The workspace OpenAPI declares all eleven member method operations above, across ten endpoint paths, at `lib/api-spec/openapi.yaml:525-738`; generated Zod models cover their request/success shapes at `lib/api-zod/src/generated/api.ts:508-780`. The local server is mounted at `/api/networking` (`routes/index.ts:29`), so the paths in the table map to the OpenAPI server base `/api`.

The schema and operation definitions document the main successful payloads and some error responses, but do not declare all handler error statuses. Examples include the `500` responses for most route operations and `401/403/409` responses omitted from several OpenAPI operations. Generated Zod output is primarily success payload/request validation and is not an exhaustive runtime error contract. Keep server source and OpenAPI synchronized before relying on a generated client.

**Adjacent photo dependency:** `POST /storage/uploads/request-url` is bearer-authenticated and accepts a JPEG/PNG/WebP image up to 1.5 MB; it creates an owned pending-upload record and returns an upload URL/path (`api-server/src/routes/storage.ts:15-44`; OpenAPI `lib/api-spec/openapi.yaml:117-156`). Account photo GET/PUT operations are outside this networking route inventory; the networking profile resolves the shared account photo, not a separate networking-photo authority (`networking.ts:52-69, 84-124`; migration `lib/db/src/migrate.ts:528-554`).

**Development-only fixtures:** The checked-in OpenAPI includes development sample restore and fixed test-member restore/delete operations (`lib/api-spec/openapi.yaml:37-115`). These mutate reserved development fixtures and are not user-facing production features. The hub's restore control is guarded by `__DEV__` (`app/(tabs)/connections.tsx:211-246`). This audit did not invoke any fixture route.

### Requested capabilities absent from the inspected Main API contract/source

The checked-in local OpenAPI/API Server implements the member operations in the table. However, based on the existing source audit of the separately supplied Main API contract snapshot, there is **no verified Main API route** for networking profile, flight front-member discovery, send/list/decide requests, connection list, messages, block/report, or networking push-token registration (`BLUEBIRD-MOBILE-CLEANUP-MAP.md:44-52, 115`). This is a limitation in the inspected production contract evidence, not a claim that a live deployed backend definitely lacks the route.

Additional capabilities absent from the local networking router and workspace OpenAPI include:

- Outgoing-request list/status and request cancellation.
- Unblock, connection removal, and report-from-conversation endpoint.
- Message pagination/history cursor, edits/deletes, read receipts, delivery status, attachment upload, typing/presence, search, or group threads.
- A websocket/SSE/subscription endpoint or server-pushed in-app message stream.
- Notification read/list endpoints specific to networking. General local notifications are handled by separate notification routes.

## 4. Data model, relationships, and security

The Drizzle schema (`lib/db/src/schema/index.ts:86-109, 252-325`) and corresponding migration DDL (`lib/db/src/migrate.ts:509-631`) define:

- **`networking_profiles`**: one row per `users.id` (`user_id` primary key, cascade delete); names, industry, bio, optional social URLs, timestamps. Photo data is account-owned and resolved from `users`, not an independent networking photo record. Completion is computed in server code: non-empty first/last name, industry, bio, and account photo (`networking.ts:71-93`).
- **`networking_photo_uploads`**: object path primary key, owner user FK, status and timestamps; cleanup index on status/created time. Upload path ownership is checked before activation (`schema/index.ts:101-109`; `networking.ts:334-398`).
- **`networking_requests`**: FK to flight, requester, recipient; message, free-text status and timestamps. Unique `(flight_id, requester_id, recipient_id)` prevents duplicate same-pair requests for one flight. A previously declined row can be reopened on a later request; the current ignore action deletes its row (`schema/index.ts:263-275`; `networking.ts:495-508, 555-558`).
- **`networking_connections`**: one connection per accepted request (`request_id` unique, cascade delete); two member FKs; unique ordered `(member_a_id, member_b_id)` pair. The handler sorts IDs before insert (`schema/index.ts:277-285`; `networking.ts:577-589`).
- **`networking_messages`**: FK to connection and sender; message content, optional client-generated ID, timestamp; partial unique `(sender_id, client_message_id)` for non-null IDs supports retry idempotency (`schema/index.ts:287-298`; `networking.ts:652-661`).
- **`networking_blocks`**: directed blocker/blocked user FKs and timestamp; unique directed pair. The helper treats a block in either direction as a blocked relationship (`schema/index.ts:300-307`; `networking.ts:127-135`).
- **`networking_reports`**: reporter and reported user FKs, optional request FK set null on request deletion, free-text reason and timestamp. No review/triage state or moderation workflow appears in this model (`schema/index.ts:309-316`).
- **Notifications and push tokens**: notifications are recipient-owned rows with type/data/read/timestamp (`schema/index.ts:252-261`); device tokens are user-owned with globally unique token (`schema/index.ts:318-325`). Networking notification helper stores an in-app row, then attempts Expo push; push errors are swallowed, and in-app notification remains the source of truth (`networking.ts:137-189`).

### Handler-level authorization and privacy behavior

- All networking routes require this API Server's Bearer JWT. Profile, front-member, request, decisions, connections, messages, and block routes additionally require a paid membership; push-token registration only requires authentication (`networking.ts:22-45, 206-233, 416-438, 465-467, 519-545, 596-600, 626-645, 671-675`).
- Request creation checks the caller's completed profile, shared-flight queue position, flight availability, and bilateral block state. The UI's message is an introduction; arbitrary member-to-member requests are not supported (`networking.ts:465-501`).
- Incoming list is restricted to the authenticated recipient and pending status. Decisions require the request recipient. Connection and message reads derive the other member from the connection and enforce participant membership (`networking.ts:519-535, 191-204, 541-554, 626-635`).
- Message GET/POST reject missing/nonparticipant/blocked connections with a generic unavailable response; block checks are bilateral. Connection list also omits blocked relationships (`networking.ts:596-618, 626-652`).
- A report stores the submitted/normalized reason but no moderation workflow is implemented here. The decision UI allows reporting a request but not a conversation; block is a separate immediate action on the thread.
- Message GET returns the complete history without cursor/limit. Connection list exposes the last-message body and social links for accepted participants. These payloads contain private member communication and profile data; a production integration must preserve participant/recipient checks and avoid public caching/logging of message contents.
- OpenAPI marks all member networking operations `bearerAuth` (`openapi.yaml:525-738`), consistent with the local router. This scheme is not a production-auth verification.

### Source-visible caveats to address before production reliance

- `GET /networking/profile` is not read-only in effect: it can insert a profile row if absent (`networking.ts:206-224`).
- `notify()` writes the notification and then attempts external push. Push transport failures are swallowed, but database insertion errors propagate to the enclosing operation's catch. Some main writes occur before notification delivery is attempted, so callers must consider retry/idempotency and partial-success semantics (`networking.ts:137-189, 503-516, 577-593, 659-668`).
- The request decision path prevents accepting a non-pending request, but block/report handling occurs before that pending-state check; verify desired behavior for already-decided requests before adopting the route as a production contract (`networking.ts:555-576`).
- Status fields are SQL text rather than database enum/check constraints in the inspected schema/migration. The allowed state machine is enforced in route code and contract types, not by the database (`schema/index.ts:263-271, 277-315`; `migrate.ts:573-622`).
- Foreign keys and uniqueness exist, but the inspected networking tables do not declare dedicated indexes for several common participant/request/message lookup columns beyond the listed unique indexes and upload cleanup index. Validate query plans against authorized production scale rather than assuming local behavior is adequate.

## 5. Reuse, priorities, dependencies, and effort

Effort ranges are **engineering-day estimates for one engineer**, not commitments. They exclude production-owner response time, app-store review, migration rollout, and unknown production backend work.

| Priority | Work | Reuse / changes needed | Dependencies and blockers | Estimate |
|---|---|---|---|---|
| P0 — unlock production path | Obtain a versioned Main API contract and owner confirmation for auth and eligibility. | Reuse flow semantics from local router only as a proposal; do not point Clerk requests at local JWT routes. Confirm token issuer/audience, linked Bluebird member ID, paid-tier source, account/photo ownership, endpoint paths, error vocabulary, and supported notification mechanism. | **Hard blocker:** website/backend source and production contract implementation are not available in this workspace. The existing cleanup map explicitly says networking is absent from the supplied production contract snapshot and production is not runtime-verified. | 1–3 days of engineering/product/API-owner work; schedule unknown. |
| P1 — production MVP API | Implement/confirm production equivalents for profile read/update, request creation and incoming list/decision, connection list, message history/send, and block/report. | Reuse mobile screens, route structure, message composer, list cards, notification routing, account-photo uploader, and generated response concepts after mapping to a verified Main API model. Use participant/recipient authorization, idempotency, pagination strategy, and server-side membership gates. | Requires P0; define request/connection status transitions, authorization contract, data retention, outgoing visibility, and moderation ownership. | 4–8 days backend + contract/codegen work if endpoint patterns and DB ownership are established; more if production schema or moderation workflow is new. |
| P1 — move mobile to production API | Add an isolated typed networking adapter and migrate the existing screens away from `@workspace/api-client-react` for production. | Existing screens largely exist. Keep the local/demo branch explicit; add environment/member-scoped query keys and preserve Clerk route/cache isolation. Keep non-member route protection. | Requires P0 and stable endpoint schemas; no production networking adapter is present in the inspected mobile sources or cleanup map. | 3–5 days mobile integration and state/error mapping. |
| P1 — safe minimum live updates | Choose and implement a production message-refresh/delivery policy. | Current UI already uses 10s message and 15s connection polling. It can be retained as a simple first version if the production API permits it; otherwise add a documented push/subscription mechanism. | Decide latency, battery/data budget, foreground/background behavior, push tap semantics, and unread/read state. Local Expo push is best-effort and not verified for production. | 1–3 days for polling contract/UI alignment; 4–8 days for a new real-time channel, excluding infrastructure. |
| P2 — profile and request UX completeness | Add outgoing request/status, cancellation and richer error handling; add block/report confirmation and clear report outcome. | Reuse profile completion UI, request card, and `networking_reports` shape only if approved by product/legal. | Requires product decisions and production operations; no outgoing/cancel endpoints or moderation workflow currently exist in inspected local source. | 2–4 days mobile plus backend/API work as needed. |
| P2 — message scale and safety | Add pagination, read state, delivery semantics, message/report controls and abuse/rate limits. | Current chronological message model and sender/client ID can seed the design but do not provide these capabilities. | Define retention/deletion, abuse escalation, rate limits, block behavior for existing connection/message history, and any attachment policy. | 3–7 days depending on backend and policy scope. |

### Practical implementation sequence

1. **Do not enable production UI or auth yet.** Keep the Clerk member gate and legacy local/demo boundary intact.
2. **Request the production networking API contract and backend owner confirmation.** Resolve the unknowns listed in [product decisions and blockers](#6-product-decisions-and-blockers).
3. **Agree on privacy/security behavior and data lifecycle**, then create/update the production OpenAPI contract and success/error models. Make explicit which local behaviors are retained versus changed.
4. **Implement/verify server authorization and persistence** against production schema, including participant checks, membership gating, bilateral blocks, notification atomicity/retry, message idempotency, pagination, report handling, and rate limiting.
5. **Add an isolated mobile networking adapter** that uses the selected Main API and fresh authorized tokens, with member-identity-scoped cache keys. Do not use the generated local JWT getter or fallback API origin for Clerk requests.
6. **Migrate one user path at a time:** profile readiness → flight introduction → incoming decisions → accepted connections → conversation send/read → block/report → notifications.
7. **Add contract and UI tests** for authorization boundaries, blocked users, duplicates/retries, expired/missing auth, empty and failure states, message ordering/pagination, and account switching. Tests against mocks prove client behavior only; production acceptance remains a separate release check.
8. **Keep local fixture/demo behavior explicitly isolated** and verify it is not accidentally reachable in release builds.

## 6. Product decisions and blockers

The inspected code cannot answer these questions. Decide them with the product, legal/trust, and API owners before production implementation:

1. Is networking available to every paid tier, or only a subset? Does profile completion include account photo as a hard requirement and can users be discoverable before opting in?
2. Is matching strictly limited to the position-one member of the same available flight? What should happen when queue position, flight state, membership, or profile changes after a request is sent?
3. Should requesters see outgoing requests, statuses, and cancellation? Can requests be resent after declined/ignored, and are old requests retained?
4. Does accepting one request create a permanent connection independent of the original flight? Can either side remove it or unblock later?
5. What exact data is visible pre-acceptance vs. post-acceptance? The local code returns first name/industry/bio/photo preview before acceptance and adds last name/social links after connection; confirm this policy.
6. What are the report categories, reason requirements, moderation queue/owner, response SLA, user notification, and escalation process? The current local table only stores reporter, reported user, optional request, reason, and timestamp.
7. What are the message retention/deletion policy, abuse limits, maximum history size, attachment policy, and read/delivery semantics?
8. What is the approved push and in-app notification contract? The local code's Expo push attempt, permissions, notification types, and deep links do not prove production delivery or background behavior.
9. Does the Main API use Clerk bearer tokens, and how does it resolve a Clerk identity to an authoritative Bluebird member and membership tier? This must be explicit; the local API expects its own JWT.
10. Does production support these routes at all? Website and production backend implementation and deployed behavior are unavailable here; the production route inventory, database model, and live behavior remain **unknown**.

## 7. Source reference index

- Mobile Connections hub and demo samples: `artifacts/bluebird/app/(tabs)/connections.tsx:24-79, 85-145, 149-310, 211-246`.
- Mobile networking profile compatibility route: `artifacts/bluebird/app/networking/profile.tsx:4-13`.
- Incoming requests UI: `artifacts/bluebird/app/networking/requests.tsx:12-61`.
- Connections list route: `artifacts/bluebird/app/networking/connections.tsx:7-31`.
- Conversation UI and client behavior: `artifacts/bluebird/app/networking/connections/[id].tsx:14-93`.
- Flight matching and request UI: `artifacts/bluebird/app/flight/[id].tsx:212-230, 290-304`.
- Profile editor, membership/local-mode gate, photo and completion: `artifacts/bluebird/app/account/personal-info.tsx:597-632, 671-679, 714-843, 1010-1072`.
- Tab visibility and Clerk route restrictions: `artifacts/bluebird/app/(tabs)/_layout.tsx:133-153, 157-201`; `artifacts/bluebird/app/_layout.tsx:71-90, 352-404`.
- Push-token registration from mobile: `artifacts/bluebird/context/AuthContext.tsx:294-319`.
- Notification route mapping and tap: `artifacts/bluebird/lib/notificationRoute.ts:1-25`; `artifacts/bluebird/app/notifications.tsx:401-405`.
- API router mount and JWT: `artifacts/api-server/src/routes/index.ts:13-30`; `artifacts/api-server/src/middlewares/auth.ts:8-52`.
- Networking server behavior: `artifacts/api-server/src/routes/networking.ts:22-45, 71-135, 137-203, 206-433, 435-684`.
- Account photo upload: `artifacts/api-server/src/routes/storage.ts:15-44, 65-80`.
- Local workspace API contract: `lib/api-spec/openapi.yaml:1-9, 525-738, 2736-2930`.
- Generated networking request/response models: `lib/api-zod/src/generated/api.ts:508-780`.
- Networking schema: `lib/db/src/schema/index.ts:86-109, 252-325`.
- Networking migration DDL and photo migration: `lib/db/src/migrate.ts:509-631`.
- Existing production-boundary audit: `artifacts/bluebird/BLUEBIRD-MOBILE-CLEANUP-MAP.md:3-5, 20-23, 44-56, 115`.
- Checked-in flow tests (not executed in this audit): `artifacts/bluebird/tests/networking-samples.spec.mjs:62-124`; `tests/networking-notifications.spec.mjs:103-258`; `tests/networking-social-links.spec.mjs:12-63`; `tests/profile-photo.spec.mjs:288-330`.
