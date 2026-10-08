# Stage 1.8 Queue UI Readiness

**Result:** COMPLETE  
**Preview checked:** Stage 1 production-read Bluebird Web Preview, 2026-10-08  
**Scope:** UI/state preparation only. No authentication implementation, production queue requests, payment behavior, backend changes, commit, or push.

## Production preview and identity

Using the Stage 1 preview with production flight-read mode and a synthetic local session only to open the app shell, I inspected real production flight **21623 (APF → BNA)**:

`Discover → Flight Details (/flight/21623) → View read-only queue access (/queue/production-unavailable?flightId=21623)`

The flight details route and read-only notice both retained positive numeric ID `21623`. The notice says queue actions and status are unavailable until production sign-in is connected, and it returns to that same flight. The details screen rendered its neutral “Aircraft details unavailable” placeholder while retaining the route, airports, flight status, and queue handoff.

Production-read queue paths and direct deep links rendered the notice without queue, trip, flight my-status, or future production queue requests. The browser regression captured no matching requests, and no queue or production mutations were performed.

## Queue flow audit

### Production path

- `artifacts/bluebird/app/(tabs)/discover/index.tsx` reads public production flights through `artifacts/bluebird/lib/productionFlights.ts`; the flight card keeps the production ID.
- `artifacts/bluebird/app/flight/[id].tsx` loads the production flight by its numeric ID. Its queue CTA is read-only and routes that ID to `artifacts/bluebird/app/queue/production-unavailable.tsx`.
- `artifacts/bluebird/components/ProductionReadOnlyNotice.tsx` validates the ID, states that queue state/actions are unavailable, displays the ID, and links back to the same flight.
- Production guards also cover direct navigation to join, international notice, payment review, joined, status, pass, buy-pass, and confirmed routes. The production Trips tab and global queue confirmation watcher do not load local queue/trip state.

### Existing local/demo path

- **Join and acknowledgements:** Flight Details → `artifacts/bluebird/app/queue/join.tsx` → local `POST /api/queue/join`; the pre-queue screen separately requires pet-policy, cancellation-risk, baggage-limit, and punctuality acknowledgements.
- **International requirement:** the local join flow can route through `artifacts/bluebird/app/queue/intl-notice.tsx` and `artifacts/bluebird/app/queue/payment-review.tsx` before joining. The payment-review screen is explicitly marked local demo only.
- **Request submitted/status:** success routes to `artifacts/bluebird/app/queue/joined.tsx`, then `artifacts/bluebird/app/queue/status.tsx`. Local queue status comes from `GET /api/queue/status`.
- **Leave:** the status screen’s leave action uses local `DELETE /api/queue/:id`.
- **Skip the Line:** joined/status routes to `artifacts/bluebird/app/queue/pass.tsx` to use a local pass, or `artifacts/bluebird/app/queue/buy-pass.tsx` when a pass must be added. These are local/demo flows only.
- **Local confirmation:** pass success and the local `artifacts/bluebird/lib/queueCelebration.tsx` watcher can route to `artifacts/bluebird/app/flight/confirmed.tsx`. That is a generic local completion screen, not production winner acceptance.
- **Winner confirmation and decline:** there is no dedicated winner-confirmation or winner-decline screen/action in the current app. The future `/winner/confirm` and `/winner/decline` endpoints are not called.

The expected later production contract—`GET`, `POST`, and `DELETE /api/empty-legs/:id/queue`, `POST /api/empty-legs/:id/skip-line`, and the winner confirm/decline endpoints—is not wired to the UI. The new state vocabulary is descriptive only; it adds no network calls or unsupported transitions.

## State, acknowledgements, and copy

- `artifacts/bluebird/lib/queueUiState.ts` can describe `not-in-queue`, `joining`, `joined`, `position`, `queue-closed`, `winner`, `confirmation-pending`, `confirmed`, `declined`, and `api-error` (message and optional HTTP status).
- Access states include `authentication-required`, `membership-required`, `profile-incomplete`, `same-day-conflict`, and `international-authorization-required`.
- Pet policy, cancellation risk, and baggage-limit checkboxes each start unchecked and must be individually acknowledged; punctuality remains separately required. The passenger-flow test verifies their accessible checked state and CTA gating.
- Production-read mode displays **no** fake probability, queue position/count, pass balance, winner, countdown, payment success, or authorization hold. Direct-route tests included deliberately fake queue values and verified they were not rendered.
- Customer-facing queue copy uses **Skip the Line Pass**. The approved UI wording states that a pass immediately wins the flight and closes its queue, costs **$2,000** standalone, and that Plus includes **five passes**. The existing public plans response still calls them “upgrades”; the client display now uses the approved Pass wording without changing the response’s plan values or benefits.
- Base international copy states a one-time **$1,000 fee or Plus**, which includes five Skip the Line Passes. The production read-only screen does not show a payment state or offer payment.
- The existing local queue backend differs from approved wording: local pass use confirms the member’s entry and shifts later queue positions, but does not close the flight’s queue. This backend behavior was not changed.
- The local international flow accepts an `acceptIntlFee` acknowledgement and has no real payment provider. Its existing authorization-hold simulation is labeled local demo only; no payment behavior was added.
- The production flight model already carries the international indicator, pass-required flag, and viewer-pass flag for future use; no queue networking was added.

## Regression results

| Area | Result | Evidence |
|---|---|---|
| Production Discover | PASS | Real flight cards rendered from the public production feed. |
| Production Flight Details | PASS | Opened flight 21623; queue handoff retained the numeric ID. |
| Production Map | PASS | Switched to Map and verified the rendered map container, then returned to List. |
| Production Plans | PASS | Public plans rendered; five-pass copy uses the approved product name and purchasing remains unavailable. |
| Production Airport Search | PASS | Searching “Dallas” returned a non-empty HTTP 200 response from the public production airport-search endpoint. |

**TypeScript:** PASS — `pnpm --filter @workspace/bluebird run typecheck`  
**Queue/passenger flow:** PASS — 5 Playwright tests in `flight-passenger-flow.spec.mjs`  
**Production preview:** PASS — 2 Playwright tests in `production-queue-readiness.spec.mjs`; no queue, trip, flight my-status, or production queue requests observed  
**Production data readers:** PASS — `test:production-flight-api`, `test:production-airport-search`, `test:production-membership-plans`  
**Map platform resolution:** PASS — `test:flight-map-platform`  
**`git diff --check`:** PASS

## Auth-blocked items

- Production member identity, membership/access eligibility, profile completion, international authorization, and same-day conflict state.
- Production queue retrieval, joining, queue position/status, leaving, and Skip the Line use or balance.
- Winner confirmation/decline and any decision/expiry state.
- A real Base international fee or Plus upgrade transaction.

## Product/backend conflicts and gaps

- The local queue API uses `/api/queue/*`, not the supplied production `/api/empty-legs/:id/*` contract.
- The approved pass behavior says the queue closes on immediate win; the local API only confirms the entry and shifts positions. Production semantics need an explicit backend decision.
- The public plans payload still uses “Skip the Line Upgrades.” The client normalizes only the customer-facing wording to “Skip the Line Passes”; backend copy was not changed.
- Local international joining records fee acceptance but performs no real authorization or charge. The local hold screen remains a clearly labeled demo; it must not be treated as a completed payment.
- Winner acceptance and decline do not exist in the current UI or local route set.

## Post-Stage-2 integration checklist

1. Confirm the authenticated production contract and add it to the API schema/code generation; preserve the validated numeric flight ID end to end.
2. Implement production queue GET/join/leave and Skip the Line calls with no local/demo fallback; map loading, queue, access, and API error responses to the prepared types.
3. Persist the required acknowledgements with the agreed policy/version fields; handle membership, profile, international authorization, same-day conflict, closed queue, and retry/conflict responses.
4. Resolve atomic pass consumption and queue-closure behavior with the backend before enabling Skip the Line; keep Plus entitlement and the $2,000 standalone price consistent.
5. Implement winner confirmation and decline UI against the approved endpoints and define pending/expiry/error behavior.
6. Connect the Base international fee-or-Plus choice to an approved payment/membership flow; show success only after verified completion.
7. Add authenticated integration tests for each role, direct links, account switching, retries, and proof that production never reaches local queue APIs.

## Files changed

- `.agents/memory/MEMORY.md`
- `.agents/memory/queue-approved-product-rules.md`
- `artifacts/bluebird/QUEUE-STAGE-1.8-READINESS.md`
- `artifacts/bluebird/app/(tabs)/discover/index.tsx`
- `artifacts/bluebird/app/(tabs)/trips/index.tsx`
- `artifacts/bluebird/app/_layout.tsx`
- `artifacts/bluebird/app/flight/[id].tsx`
- `artifacts/bluebird/app/flight/confirmed.tsx`
- `artifacts/bluebird/app/flight/policy.tsx`
- `artifacts/bluebird/app/queue/buy-pass.tsx`
- `artifacts/bluebird/app/queue/intl-notice.tsx`
- `artifacts/bluebird/app/queue/join.tsx`
- `artifacts/bluebird/app/queue/joined.tsx`
- `artifacts/bluebird/app/queue/pass.tsx`
- `artifacts/bluebird/app/queue/payment-review.tsx`
- `artifacts/bluebird/app/queue/production-unavailable.tsx`
- `artifacts/bluebird/app/queue/status.tsx`
- `artifacts/bluebird/components/PrimaryButton.tsx`
- `artifacts/bluebird/components/ProductionReadOnlyNotice.tsx`
- `artifacts/bluebird/lib/productionMembershipPlans.ts`
- `artifacts/bluebird/lib/queueCelebration.tsx`
- `artifacts/bluebird/lib/queueUiState.ts`
- `artifacts/bluebird/package.json`
- `artifacts/bluebird/playwright.config.mjs`
- `artifacts/bluebird/tests/flight-passenger-flow.spec.mjs`
- `artifacts/bluebird/tests/production-membership-plans.spec.mjs`
- `artifacts/bluebird/tests/production-queue-readiness.spec.mjs`

No commit or push was made.

STAGE 1.8 QUEUE READINESS: COMPLETE
