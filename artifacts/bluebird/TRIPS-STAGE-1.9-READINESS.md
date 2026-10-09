# Stage 1.9 My Trips / Trip Details Readiness

## Existing architecture audit

This audit records the trip flow and contracts before the Stage 1.9 UI changes.

### Routes and handoffs

| Flow | Current route/source | Data/action |
|---|---|---|
| My Trips | `app/(tabs)/trips/index.tsx` | In local demo mode, loads `GET /api/trips` and `GET /api/queue/status`; cancellation uses local `POST /api/trips/:id/cancel`. Upcoming and past trip cards previously opened the flight route using `trip.flight.id`. Pending queue cards open `/queue/status`. |
| Flight confirmation | `app/flight/confirmed.tsx` | Local queue/pass success can open this route. The screen receives flight fields as route parameters and has local calendar/share/celebration UI. Production-read mode returns a queue-unavailable notice. |
| Confirmed flight → passengers | `app/flight/[id].tsx` | Local `GET /api/flights/:flightId/my-status` may provide a `tripId`; that trip ID opens `/trip/:tripId/passengers`. Production flight detail does not load my-status or mutate queue/trip state. |
| Passenger and pet details | `app/trip/[id]/passengers.tsx` | Existing local API calls: `GET /api/trips/:tripId/manifest`, `GET /api/passengers`, `PUT /api/trips/:tripId/manifest`, `POST /api/trips/:tripId/manifest/submit`, and `POST /api/passengers`. Pet measurements are part of the manifest form when `bringingPet` is true; there is no separate pet route. |
| Trip details | No screen existed. | My Trips linked directly to Flight Details, so the trip identity and its flight/leg identity were not represented as separate route concepts. |
| Boarding pass / Apple Wallet | No screen, route, QR generation, pass endpoint, or Wallet integration exists. | A payment-method “wallet” is separate from an Apple Wallet boarding pass. |
| Trip checklist | No checklist route or persisted checklist exists. | Confirmation screen contains a fixed “Next Steps” presentation with calendar, itinerary, and early-arrival reminders; it is not a saved trip checklist. |

### API, fixture, and identity assumptions

- The local generated client models `Trip.id` and `Trip.flightId` as strings; `Trip.flight.id` is also a string. The demo seed uses trip IDs such as `demo-trip-upcoming-<member>` and `demo-trip-completed-<member>`. Newly created local IDs are opaque base-36/random strings.
- A trip is not a flight. My Trips should route with `trip.id`; a flight/empty-leg detail route should route with `trip.flightId` / `trip.flight.id`.
- The production public empty-leg contract uses positive numeric IDs (for example, `21623`). The flight reader preserves that numeric identity as a decimal string in `FlightView.id`; the existing parser validates it before production flight reads. The production flight response may have a separate optional `tripId`, but no production trip reader is wired.
- Local demo fixtures come from the API server’s demo seeding/simulation paths. They are accessed only through the local-mode API client. Stage 1 production-read mode uses public flight/airport/plans readers and must not use those fixture responses as member trip state.
- The trip-list contract contains only `upcoming`, `completed`, and `cancelled` trip statuses. Its optional manifest summary is present for eligible upcoming trips. It does not establish separate won, confirmation-pending, declined, boarding-pass, or Wallet states.
- The manifest contract contains passenger first/last name, optional phone/email/date of birth/weight, a `bringingPet` flag, and pet weight/crate dimensions. It has no pet name, type, or size fields. The current client additionally uses the established local rules for required passenger fields, trip eligibility, and six total occupants including a pet.
- The public production flight shape includes route, schedule, and aircraft fields when supplied, but those fields are not a member trip record. FBO details are not part of a public trip-detail contract; the current authenticated local confirmed-flight response is the only existing UI source for assigned FBO details.

## Stage 1.9 implementation and verification

### Readiness results

| Area | Result | Notes |
|---|---|---|
| My Trips production-read entry | **PASS** | Shows a neutral sign-in/read-only state. It does not load trips or queue status, show demo fixtures, or offer account mutations. |
| Trip and flight identity | **PASS** | My Trips now navigates with `trip.id`; flight details continue to use flight/leg IDs. Numeric production leg ID `21623` is preserved as an opaque route value and is never converted into a trip ID. Invalid route values show an unavailable state without a data request. |
| Local demo trips and navigation | **PASS** | Local demo mode retains its own fixtures. Upcoming and past cards open Trip Details; cancelled trips retain their status and do not expose passenger actions. Empty, missing, loading, and API-error states are explicit. Back navigation from Passenger Information returns to Trip Details. |
| Passenger and pet details | **PASS** | Existing passenger and pet fields and validations remain. The read-only production route does not show local names, measurements, or manifest values. Local locked, unavailable, and incomplete states are distinct. No pet identity fields were added. |
| Confirmation and trip statuses | **PASS WITH CONTRACT LIMIT** | Existing flight confirmation and pending-queue flows remain distinct. The trip-list contract has only `upcoming`, `completed`, and `cancelled`; no separate trip `confirmed` or `confirmation_pending` status is invented. |
| Boarding pass and Apple Wallet | **DEFERRED** | The route and unavailable state are present. No QR/pass is generated, and Wallet is explicitly unavailable because there is no authenticated boarding-pass or Wallet contract. |
| Checklist | **DEFERRED** | The current confirmation screen has static “Next Steps” content, not a persisted trip checklist. No checklist screen or transition was fabricated. |
| Production trip integration | **DEFERRED** | Browser checks observed no trip, manifest, saved-passenger, or mutation requests from production-read My Trips, Trip Details, Passenger Information, or Boarding Pass. |

### Backend-contract uncertainties

- There is no authenticated production contract for listing a member’s trips or resolving a trip’s flight/leg reference. Production leg IDs and member trip IDs must remain separate.
- Existing trip responses do not define production confirmation-pending/confirmed states or their allowed transitions. The queue’s pending state and the flight’s existing confirmation status are not substitutes for a production trip status.
- Production manifest ownership, authorization, and the exact authenticated read/save/submit outcomes are not established. Current passenger and pet APIs remain local-demo-only.
- The only current FBO source is an authenticated local confirmed-flight response; no production trip-detail contract authorizes FBO instructions.
- There is no boarding-pass retrieval/issuance API, QR payload/lifetime contract, Apple Wallet provisioning contract, or persisted checklist API.

### Post-auth integration checklist

1. Define authenticated trip-list/detail contracts and the mapping between member trip IDs and numeric flight/leg IDs; update OpenAPI and regenerate the client before wiring requests.
2. Confirm server-side ownership and authorization for trip and manifest reads/mutations, plus the supported status/error transitions (`401`, `403`, `404`, `409`) and existing passenger/pet validation rules.
3. Add production reads only after auth exists; expose FBO information only from an authorized confirmed response. Keep demo fixtures and simulation isolated from production.
4. Define whether boarding passes, QR codes, Apple Wallet, and a persisted checklist are in scope, then specify their APIs and lifecycle before displaying production success.
5. Add authenticated end-to-end coverage for member switching, trip/leg identity, status handling, passenger/pet privacy, FBO authorization, and pass/Wallet availability.

### Verification results

- **PASS** — Production-readiness browser suite: `EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production pnpm --filter @workspace/bluebird run test:production-queue-readiness` — 3/3. Covers Discover/Flight Details/Map/queue public paths, Membership Plans, Airport Search, and confirms zero member trip/manifest requests on the production-read trip routes.
- **PASS** — Local passenger/trip browser suite: `pnpm --filter @workspace/bluebird exec playwright test tests/flight-passenger-flow.spec.mjs --workers=1` — 11/11. Covers empty/upcoming/past/cancelled, trip API error, locked manifest, My Trips → Trip Details → Passenger Information/boarding availability, malformed IDs, pet measurement fields, and existing flight/queue flows.
- **PASS** — `test:production-flight-api`, `test:production-airport-search`, `test:production-membership-plans`, `test:passenger-name-prefill`, and `test:flight-map-platform`.
- **PASS** — `pnpm exec tsc -b lib/api-client-react` and `pnpm --filter @workspace/bluebird run typecheck`.
- **PASS** — `git diff --check`.
- **PREVIEW NOTE** — The restarted Expo workflow serves the app, but the screenshot browser has no member session and stays on the existing splash at `/trips`. Signed-in trip and passenger routes were exercised with a synthetic local browser session in Playwright; no production authentication was added.

### Changed files

- `app/(tabs)/trips/index.tsx`
- `app/_layout.tsx`
- `app/trip/[id]/index.tsx` (new)
- `app/trip/[id]/boarding-pass.tsx` (new)
- `app/trip/[id]/passengers.tsx`
- `components/TripAvailabilityState.tsx` (new)
- `lib/tripRoutes.ts` (new)
- `tests/flight-passenger-flow.spec.mjs`
- `tests/production-queue-readiness.spec.mjs`
- `TRIPS-STAGE-1.9-READINESS.md`

No authentication, API schema, database, payment, or Wallet integration was added. No commit or push was made.
