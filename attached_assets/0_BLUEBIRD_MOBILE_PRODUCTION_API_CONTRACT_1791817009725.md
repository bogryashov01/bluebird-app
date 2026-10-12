# BLUEBIRD MOBILE PRODUCTION API CONTRACT

Source snapshot: 2026-10-12. Documentation only. Production runtime tested: **NO**.

## Scope and authority

30 endpoints: 22 requested member operations, six admin/concierge manifest mutations, and two charter passenger mutations. Admin routes are NOT member APIs. No backend/auth modifications, credential access, authenticated production requests, database writes, SMS sends, deployment, commits or pushes were performed.

Actual route/service projections and checks take precedence over generated Zod and OpenAPI descriptions. The registry below preserves structural schemas from lib/api-spec/openapi.yaml, with explicit source corrections below. Descriptions were removed to avoid stale business prose. References resolve inside this document's components.schemas registry. Wire dates are strings, not JavaScript Date objects. This is a source snapshot, not proof that a particular deployment runs this revision.

## Authentication and expiration

Use Authorization: Bearer <Clerk session token> over HTTPS. Never place server credentials in mobile. app.ts mounts @clerk/express before /api. lib/clerkAuth.ts resolves active/pending sessions and server-controlled impersonation. Cookies, an app CSRF token and browser-specific headers are not required by these member handlers. JSON bodies use Content-Type: application/json. Clerk validates token expiration; there is no custom refresh endpoint here. Refresh/get session tokens through Clerk SDK. Protected routes return 401 when user identity is unresolved; /api/me instead returns 200 signed-out data, including on caught identity lookup errors. Exact expired/malformed-token middleware response and production session TTL are UNKNOWN without runtime/dashboard evidence. Do not assume every expired token produces a JSON 401. Native callers have the same profile, membership, winner, manifest-lock and role restrictions as web callers. Production Clerk instance parity remains UNKNOWN.

Sources: artifacts/api-server/src/app.ts, lib/clerkAuth.ts, lib/impersonation.ts; artifacts/bluebird/src/App.tsx; lib/api-client-react/src/custom-fetch.ts.

## /api/me examples (fictional and source-derived)

Normal anonymous HTTP 200:
```json
{"isAuthenticated":false,"isAdmin":false,"isConcierge":false,"isMember":false,"memberTier":null,"email":null,"firstName":null,"lastName":null,"isProfileComplete":false,"needsPlanDecision":false,"needsSignupPhone":false,"impersonation":null}
```
Authenticated example:
```json
{"isAuthenticated":true,"isAdmin":false,"isConcierge":false,"isMember":true,"memberTier":"base","email":"member@example.com","firstName":"Example","lastName":"Member","isProfileComplete":true,"needsPlanDecision":false,"needsSignupPhone":false,"impersonation":null}
```
Caught /me failure uses anonymous fields but omits impersonation. userId and inviteGateEnabled are not returned by the response parser. Profile completion actually requires email, names/DOB/gender/home airport/favorites, plus verified phone when required. needsSignupPhone is scoped to accounts without a profile and without a verified Clerk phone/signup-channel marker; needsPlanDecision means complete profile but no recorded plan decision.

## GET side effects: do not use these as read-only probes

- GET /api/me/profile may UPDATE missing verified-phone fields from Clerk.
- GET /api/empty-legs/{id}/passengers may INSERT the lead passenger.
- GET /api/me/phone-verification/status may UPSERT profile verification, update Clerk phone/metadata and sync Sendblue contact data when verified.
- Related GET /api/trips/{legId}, outside this document's 30-operation set, calls getOrCreateChecklistRow and may INSERT checklist state.

## Source-derived schema corrections and caveats

1. TripLegSummary emits queueClosesAt. TripChecklist emits awarded. Both are added below; all explicitly projected fields are required. /trips has no independent trip status enum or trip UUID.
2. Phone verification profile lacks upgradeCreditBalances; PhoneVerifiedProfile is the actual projection, not full UserProfile. Recovery always emits method/expiresAt/cooldownSeconds. Nullable syntax is normalized to JSON Schema union types.
3. Profile/member-manifest DOB stays date-only. Admin manifest response parsing coerces DOB into Date and serializes ISO datetime. Admin schema DOB format is corrected below.
4. Skip/confirm/decline EmptyLeg prices are neutralized: pricePerHour=0,totalPrice=null,msrpUsd=null. Historical OpenAPI prices are not current sales permission.
5. OpenAPI integer/date constraints describe intended client input, but generated Zod frequently uses number() without int() and coerce.date(). Exact input-validator excerpts and resolved constants are included. Routes may add checks/rounding: do not infer decimal rejection merely from OpenAPI integer. Send integer IDs and whole-pound weights; profile weightLbs explicitly checks integer.
6. Do not infer strict unknown-property rejection: generated object parsing ordinarily strips undeclared fields. Passenger and pet PATCH endpoints require full bodies, not sparse patches.
7. SourceError is a superset of explicit route error fields, not a promise every error carries code/reason. Unhandled middleware/provider/database response bodies are UNKNOWN. Dynamic error strings are not stable enums.
8. Status/check use hand-written input validation, not the generated CheckPhoneVerificationBody/QueryParams excerpts. In particular code regex is enforced; phone is normalized by the handler. The schema is the recommended client payload, not proof every min/max is enforced by that route.
9. All named schema fields are source-defined. Production values, settings and provider failure details remain untested. Response fields not listed are not invented.

## Comparison with the separate mobile local contract

The separate mobile OpenAPI file was not provided or accessible here. The exact old-path/old-field diff is UNKNOWN. The prior report described an API client, not its local schemas. No old route names or aliases are fabricated.

Compare its contract with these verified facts: profile is GET/PUT /api/me/profile; /me can return anonymous HTTP200; /trips wraps current/past arrays and uses numeric empty-leg IDs; queue read is a public array, join/leave return aggregates, skip/winner actions return enriched EmptyLeg; passenger/pet mutations return manifests; pet fields are breed/weight (pounds); admin manifest is distinct; Bluebird PIN is separate from Clerk login; some GETs mutate state. Supply the mobile contract file to produce a literal diff—production access is not needed.

## Endpoint contracts

Every operation below is verified from source and NOT tested against production. No extra query parameters are part of this contract. {id} is equivalent to Express :id. Preserve the per-endpoint path type; never infer UUIDs from an identifier's name. Error cases after schema declarations include runtime statuses omitted from OpenAPI.

### 1. GET /api/me

- Source: artifacts/api-server/src/routes/me.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: getCurrentUser
- Authentication: Optional. Bearer needed for authenticated result.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/CurrentUser"
  }
}
```

- Error cases: No route-specific 401; caught failure returns CurrentUser. Middleware failures outside handler are not normalized. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Calls getCurrentUserInfo then GetCurrentUserResponse.parse. No userId or inviteGateEnabled on wire. Normal anonymous response is 200 with false flags/null values. Caught identity/database/schema failure is also 200 signed-out, omitting impersonation. Admin implies concierge; impersonated admin sees target identity plus impersonation metadata.

### 2. GET /api/me/profile

- Source: artifacts/api-server/src/routes/profile.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: getMyProfile
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/UserProfile"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: GET:401. PUT:400 invalid names/DOB/airport/cities/phone/country/verification/preferences/consent/email/weight; unknown cities include unknownKeys:string[]. 401; explicit 500 Failed to save profile. Other uncaught upstream failures have UNKNOWN body. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Returns UserProfile or empty-profile defaults (not null). Can UPDATE an existing profile from Clerk verified-phone information when phone is missing: GET is not strictly read-only. DOB remains YYYY-MM-DD; response bypasses generated date coercion.

### 3. PUT /api/me/profile

- Source: artifacts/api-server/src/routes/profile.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: updateMyProfile
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/UpdateUserProfileRequest"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/UserProfile"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: GET:401. PUT:400 invalid names/DOB/airport/cities/phone/country/verification/preferences/consent/email/weight; unknown cities include unknownKeys:string[]. 401; explicit 500 Failed to save profile. Other uncaught upstream failures have UNKNOWN body. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Full required-profile PUT, not partial PATCH. Trim names; DOB must be real, past and age >=18; home airport and favorite city keys must exist. Phone country/number must match; new users must verify phone. SMS preferences require separately explicit smsConsent; phone verification never implies consent. Locked OAuth email is not overwritten. Editable email can be synchronized into Clerk. Omitted notification preferences/consent preserve existing values; first-create uses defaults. weightLbs is nullable integer 1..1500. Can trigger provider/profile/notification side effects.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const UpdateMyProfileBody = zod.object({
  firstName: zod.string().min(1).max(updateMyProfileBodyFirstNameMax),
  lastName: zod.string().min(1).max(updateMyProfileBodyLastNameMax),
  dob: zod.coerce
    .date()
    .describe(
      "Date of birth as YYYY-MM-DD. Must be a real past date and the user must be at least 18 years old.",
    ),
  gender: zod.enum(["male", "female"]),
  homeAirportCode: zod
    .string()
    .min(updateMyProfileBodyHomeAirportCodeMin)
    .max(updateMyProfileBodyHomeAirportCodeMax)
    .describe(
      "IATA (3-letter) or ICAO (4-letter) code of the user's home airport. Must reference an existing airport.",
    ),
  favoriteCityKeys: zod
    .array(zod.string().min(1).max(updateMyProfileBodyFavoriteCityKeysItemMax))
    .min(1)
    .describe(
      "At least one favorite city key is required (see\n`AirportCity.key`). The server resolves each key to its\nunderlying airport IDs and persists those — the\n`favorite_airport_ids` database column itself is unchanged.\nUnknown keys are rejected with HTTP 400.\n",
    ),
  phoneE164: zod
    .string()
    .nullish()
    .describe(
      "Phone number in canonical E.164 form (e.g. `+15555550123`).\nRequired for new signups (`phoneVerificationRequired = true`)\n— the server rejects the save with HTTP 400 when missing.\nOptional only for grandfathered legacy profiles. Server\nnormalizes any plain US 10-digit number to `+1XXXXXXXXXX`.\n",
    ),
  phoneCountry: zod
    .string()
    .nullish()
    .describe(
      "ISO 3166-1 alpha-2 country code from the country dropdown\n(e.g. `US`). Required whenever `phoneE164` is supplied. The\nserver cross-checks it against the country list and rejects\nunknown codes.\n",
    ),
  notificationPrefs: zod
    .object({
      mode: zod.enum(["off", "all", "specific"]),
      allChannels: zod
        .union([
          zod
            .enum(["email", "sms", "both"])
            .describe(
              "Channel choice attached to a notification preference slot.\n`email` and `sms` are exclusive; `both` sends to both.\n",
            ),
          zod.null(),
        ])
        .describe(
          'Channel for the \"notify me on every published flight\" mode.',
        ),
      emptyLegHomeAirport: zod
        .union([
          zod
            .enum(["email", "sms", "both"])
            .describe(
              "Channel choice attached to a notification preference slot.\n`email` and `sms` are exclusive; `both` sends to both.\n",
            ),
          zod.null(),
        ])
        .describe("Empty leg posted to or from the member's home airport."),
      departingFavorite: zod
        .union([
          zod
            .enum(["email", "sms", "both"])
            .describe(
              "Channel choice attached to a notification preference slot.\n`email` and `sms` are exclusive; `both` sends to both.\n",
            ),
          zod.null(),
        ])
        .describe("Flight posted departing from a favorite airport."),
      arrivingFavorite: zod
        .union([
          zod
            .enum(["email", "sms", "both"])
            .describe(
              "Channel choice attached to a notification preference slot.\n`email` and `sms` are exclusive; `both` sends to both.\n",
            ),
          zod.null(),
        ])
        .describe("Flight posted arriving at a favorite airport."),
      queueUpdates: zod
        .enum(["email", "sms", "both"])
        .describe(
          'Channel for queue-update notifications (joined, position changed, closing soon, closed-not-selected, departure changed). Mandatory transactional sends, so channel-only with no \"off\". Defaults to \"both\".',
        ),
      winningNotifications: zod
        .enum(["email", "sms", "both"])
        .describe(
          'Channel for winning notifications (selected from the queue, confirm within 1 hour). Mandatory transactional sends, so channel-only with no \"off\". Defaults to \"both\".',
        ),
    })
    .optional()
    .describe(
      "Notification routing preferences. Optional; when omitted on a\nfirst-time profile create the server defaults to\nhome-airport alerts and transactional notifications on email only.\nSMS requires a separate explicit opt-in. On subsequent\nupdates the current value is left in place.\n",
    ),
  smsConsent: zod
    .boolean()
    .optional()
    .describe(
      "SMS A2P 10DLC consent flag from the consent checkbox on the\nnotification setup page, never inferred from verifying a phone.\nOptional on the wire; when\nomitted the server keeps the current saved value. The\nserver stamps `smsConsentAt` \/ `smsConsentRevokedAt`\nautomatically on the false→true \/ true→false transition.\nWhen any active notification preference uses SMS (`sms` or\n`both`) the server requires this to be true and rejects the\nsave with HTTP 400 otherwise.\n",
    ),
  email: zod
    .string()
    .email()
    .min(updateMyProfileBodyEmailMin)
    .max(updateMyProfileBodyEmailMax)
    .optional()
    .describe(
      "User's primary email address. Required for phone-only\nsignups (collected on the profile page since SMS OTP\ndoesn't supply an email). Ignored when the account is\nowned by an OAuth provider that already supplied a\nverified email (`emailLocked = true` in `UserProfile`).\nServer writes the supplied address to Clerk as a verified\nprimary email — no email-verification round trip is\nperformed.\n",
    ),
  weightLbs: zod
    .number()
    .min(1)
    .max(updateMyProfileBodyWeightLbsMax)
    .nullish()
    .describe(
      "Optional self-reported body weight in whole pounds. Send a\npositive integer between 1 and 1500, or null \/ omit to leave\nit unset. Never required — omitting it (or sending null)\nalways validates and never blocks the save. The server\nrejects non-integer, zero\/negative, or out-of-range values\nwith HTTP 400.\n",
    ),
});
```

### 4. POST /api/me/phone-verification/start

- Source: artifacts/api-server/src/routes/phoneVerification.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: startPhoneVerification
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/StartPhoneVerificationRequest"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/PhoneVerificationStartResult"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "429": {
    "$ref": "#/components/schemas/PhoneVerificationRateLimitedResponse"
  },
  "503": {
    "allOf": [
      {
        "$ref": "#/components/schemas/ErrorResponse"
      },
      {
        "type": "object",
        "properties": {
          "reason": {
            "type": "string",
            "enum": [
              "capacity",
              "acceptance_unknown"
            ]
          },
          "retryAfterSeconds": {
            "type": "integer",
            "minimum": 1
          }
        }
      }
    ]
  }
}
```

- Error cases: 400 invalid schema/country/phone; 401; 429 phone_cooldown/user_daily_limit/wrong_code_lockout with retryAfterSeconds; 502 undeliverable/send_failed; 503 unavailable/disabled/capacity/acceptance_unknown. reason/retryAfterSeconds may be absent. 503 sets Retry-After when result supplies retryAfterSeconds. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Bluebird Quo phone ownership PIN, NOT Clerk login OTP. start validates country/phone pair and sends SMS. check validates six numeric characters, consumes code, then uses shared status handler; GET status takes phoneE164 query. Recovery always emits method pin|legacy_reply, expiresAt nullable and cooldownSeconds. status enum pending|verified|expired|none. Verified check AND GET status can upsert profile, sync verified phone and metadata to Clerk and upsert Sendblue contact. Status GET is not read-only. Actual verified profile omits upgradeCreditBalances; corrected PhoneVerifiedProfile is used below. No SMS consent is implied. Avoid automatic resend after ambiguous provider acceptance.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const StartPhoneVerificationBody = zod.object({
  countryIso2: zod
    .string()
    .min(startPhoneVerificationBodyCountryIso2Min)
    .max(startPhoneVerificationBodyCountryIso2Max)
    .describe(
      "ISO 3166-1 alpha-2 country code matching one of the entries in\nthe curated country list (`@workspace\/country-list`). The\nserver cross-checks this against the dial code prefix of\n`phoneE164` and rejects mismatches with HTTP 400.\n",
    ),
  phoneE164: zod
    .string()
    .min(startPhoneVerificationBodyPhoneE164Min)
    .max(startPhoneVerificationBodyPhoneE164Max)
    .describe(
      "Candidate phone number in canonical E.164 form (e.g.\n`+15555550123`). Must satisfy the country's national-number\nlength rules; the server normalizes any plain US 10-digit\nnumber to `+1XXXXXXXXXX` for backward compatibility.\n",
    ),
});
```

### 5. POST /api/me/phone-verification/check

- Source: artifacts/api-server/src/routes/phoneVerification.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: checkPhoneVerification
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/CheckPhoneVerificationRequest"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/PhoneVerificationStatusResult"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "note": "UNKNOWN: no declared JSON schema"
  },
  "429": {
    "note": "UNKNOWN: no declared JSON schema"
  },
  "503": {
    "note": "UNKNOWN: no declared JSON schema"
  }
}
```

- Error cases: 400 invalid_code/expired/reused or malformed phone; 401; 429 wrong_code_lockout; 503 unavailable. Six-digit code validation occurs before authentication. Uncaught dependency failures UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Bluebird Quo phone ownership PIN, NOT Clerk login OTP. start validates country/phone pair and sends SMS. check validates six numeric characters, consumes code, then uses shared status handler; GET status takes phoneE164 query. Recovery always emits method pin|legacy_reply, expiresAt nullable and cooldownSeconds. status enum pending|verified|expired|none. Verified check AND GET status can upsert profile, sync verified phone and metadata to Clerk and upsert Sendblue contact. Status GET is not read-only. Actual verified profile omits upgradeCreditBalances; corrected PhoneVerifiedProfile is used below. No SMS consent is implied. Avoid automatic resend after ambiguous provider acceptance.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const CheckPhoneVerificationBody = zod.object({
  phoneE164: zod
    .string()
    .min(checkPhoneVerificationBodyPhoneE164Min)
    .max(checkPhoneVerificationBodyPhoneE164Max),
  code: zod.string().regex(checkPhoneVerificationBodyCodeRegExp),
});
```

### 6. GET /api/me/phone-verification/status

- Source: artifacts/api-server/src/routes/phoneVerification.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: getPhoneVerificationStatus
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "phoneE164",
    "in": "query",
    "required": true,
    "schema": {
      "type": "string",
      "minLength": 8,
      "maxLength": 16
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/PhoneVerificationStatusResult"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 missing/invalid phoneE164; 401; uncaught dependency failures UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Bluebird Quo phone ownership PIN, NOT Clerk login OTP. start validates country/phone pair and sends SMS. check validates six numeric characters, consumes code, then uses shared status handler; GET status takes phoneE164 query. Recovery always emits method pin|legacy_reply, expiresAt nullable and cooldownSeconds. status enum pending|verified|expired|none. Verified check AND GET status can upsert profile, sync verified phone and metadata to Clerk and upsert Sendblue contact. Status GET is not read-only. Actual verified profile omits upgradeCreditBalances; corrected PhoneVerifiedProfile is used below. No SMS consent is implied. Avoid automatic resend after ambiguous provider acceptance.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const GetPhoneVerificationStatusQueryParams = zod.object({
  phoneE164: zod.coerce
    .string()
    .min(getPhoneVerificationStatusQueryPhoneE164Min)
    .max(getPhoneVerificationStatusQueryPhoneE164Max)
    .describe("Same E.164 number that was supplied to `\/start`."),
});
```

### 7. GET /api/membership

- Source: artifacts/api-server/src/routes/membership.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: getMembership
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/Membership"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 401; uncaught service/database/provider failures have UNKNOWN body. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: buildResponse parses GetMembershipResponse. Tiers base/plus/null (Plus Family is not a third tier). isMember uses isEffectivelyActive; do not infer active entitlement from tier alone. Status active/canceled/expired/pending_payment/null; paymentStatus none/pending/succeeded/failed/null. No membership => false/null fields, cancelAtPeriodEnd false, events retained if any. GET metaPurchase=null. Unknown recent event variants are filtered individually. Cents fields are cents, not dollars.

### 8. GET /api/empty-legs/{id}/queue

- Source: artifacts/api-server/src/routes/queue.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: getEmptyLegQueue
- Authentication: Optional; public ranking, token personalizes isViewer.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "type": "array",
    "items": {
      "$ref": "#/components/schemas/PublicQueueEntry"
    }
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 invalid path;404 missing/unpublished/invalid-route flight. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Array of position,initials,tier,hasLineSkip,isViewer. No member IDs. Position is 1-based. Requires published valid-route flight; UNKN route hidden.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const GetEmptyLegQueueParams = zod.object({
  id: zod.coerce.number(),
});
```

### 9. POST /api/empty-legs/{id}/queue

- Source: artifacts/api-server/src/routes/queue.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: joinEmptyLegQueue
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Optional body; route defaults absent body to {} where applicable.

```json
{
  "$ref": "#/components/schemas/JoinEmptyLegQueueRequest"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/QueueEntry"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "402": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "409": {
    "$ref": "#/components/schemas/JoinEmptyLegQueueConflictResponse"
  }
}
```

- Error cases: 400 params/body;401;402 insufficient_credit/international_pass_required or credit-service denial;403 profile_incomplete/not active;404 flight invalid;409 closed/departed/same-day or family conflict. conflict object and code may be returned. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: joinQueue enforces complete profile, published valid route, departure/close time, active membership, one local-day queue per user/family, international authorization/credit rules. Optional body defaults to {}. Credits are reserved/validated server-side; client cannot select own rank/tier. Returns aggregate QueueActionResult.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const JoinEmptyLegQueueParams = zod.object({
  id: zod.coerce.number(),
});

export const JoinEmptyLegQueueBody = zod
  .object({
    internationalPassAuthorized: zod
      .boolean()
      .optional()
      .describe(
        "Set to `true` to authorize the international pass charge (currently $1,000) if you win the queue.\nRequired for Base members joining an international flight; ignored otherwise.\n",
      ),
    useInternationalPassCredit: zod
      .boolean()
      .optional()
      .describe(
        'When `true` (and the member has a banked International Pass\ncredit), the pass is backed by a credit instead of the cash\nfee: nothing is charged, and one credit is SPENT only if the\nmember wins. Ignored unless `internationalPassAuthorized` is\nalso true. Rejected with 402 `code: \"insufficient_credit\"`\nwhen the member has no International Pass credit.\n',
      ),
  })
  .describe(
    "Optional join-queue payload. Required when a Base member joins the queue for an international flight.",
  );
```

### 10. DELETE /api/empty-legs/{id}/queue

- Source: artifacts/api-server/src/routes/queue.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: leaveEmptyLegQueue
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/QueueStatus"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 params;401;404 flight/not in queue;409 cannot leave with reason code. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: leaveQueue deletes caller entry only. Closed/departed queue cannot be left; winner must decline instead. Returns aggregate QueueActionResult. No body.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const LeaveEmptyLegQueueParams = zod.object({
  id: zod.coerce.number(),
});
```

### 11. POST /api/empty-legs/{id}/skip-line

- Source: artifacts/api-server/src/routes/queue.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: purchaseLineSkip
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Optional body; route defaults absent body to {} where applicable.

```json
{
  "$ref": "#/components/schemas/PurchaseLineSkipRequest"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLeg"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "402": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "409": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 params/body;401;402 insufficient_credit;403 profile_incomplete/not member/not in queue;404 flight missing;409 departed or skip sold. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Optional {useCredit:boolean}. Requires complete profile, published nondeparted flight, active membership and caller in queue. Single skip slot. useCredit spends banked credit. Non-credit branch reserves skip slot without a hosted-checkout call in inspected route; do not infer a payment integration from price text. Returns EmptyLeg with neutralized pricePerHour=0,totalPrice=null,msrpUsd=null.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const PurchaseLineSkipParams = zod.object({
  id: zod.coerce.number(),
});

export const PurchaseLineSkipBody = zod
  .object({
    useCredit: zod
      .boolean()
      .optional()
      .describe(
        'Spend one banked Skip-the-Line credit to take the slot.\nRejected with 402 `code: \"insufficient_credit\"` when the\nmember has no Skip-the-Line credit.\n',
      ),
  })
  .describe(
    "Optional skip-the-line payload. When omitted the slot is taken\nthe historical way (no cash captured today). When `useCredit` is\ntrue the slot is backed by a banked Skip-the-Line credit, which\nis spent immediately on purchase and returned if the leg is later\ncancelled (refund-on-non-win parity).\n",
  );
```

### 12. GET /api/empty-legs/{id}/passengers

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: listEmptyLegPassengers
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion. GET can INSERT account-holder passenger via ensureAccountHolderPassenger.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const ListEmptyLegPassengersParams = zod.object({
  id: zod.coerce.number(),
});
```

### 13. POST /api/empty-legs/{id}/passengers

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: addEmptyLegPassenger
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPassengerInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "409": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AddEmptyLegPassengerParams = zod.object({
  id: zod.coerce.number(),
});

export const AddEmptyLegPassengerBody = zod
  .object({
    firstName: zod.string().min(1).max(addEmptyLegPassengerBodyFirstNameMax),
    middleName: zod
      .string()
      .max(addEmptyLegPassengerBodyMiddleNameMax)
      .nullish(),
    lastName: zod.string().min(1).max(addEmptyLegPassengerBodyLastNameMax),
    weight: zod.number().min(1).max(addEmptyLegPassengerBodyWeightMax),
    gender: zod
      .enum(["male", "female"])
      .describe(
        "Operator manifest gender. Restricted to male\/female to match the\nmember profile gender field; the operator's compliance forms only\naccept these two buckets.\n",
      ),
    dob: zod.coerce.date(),
    notes: zod.string().max(addEmptyLegPassengerBodyNotesMax).nullish(),
  })
  .describe(
    "Passenger payload submitted by the empty-leg queue winner. Mirrors\n`AddPassengerInput` exactly so the same form can be reused by the\nclient.\n",
  );
```

### 14. PATCH /api/empty-legs/{id}/passengers/{passengerId}

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: updateEmptyLegPassenger
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "passengerId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPassengerInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const UpdateEmptyLegPassengerParams = zod.object({
  id: zod.coerce.number(),
  passengerId: zod.coerce.number(),
});

export const UpdateEmptyLegPassengerBody = zod
  .object({
    firstName: zod.string().min(1).max(updateEmptyLegPassengerBodyFirstNameMax),
    middleName: zod
      .string()
      .max(updateEmptyLegPassengerBodyMiddleNameMax)
      .nullish(),
    lastName: zod.string().min(1).max(updateEmptyLegPassengerBodyLastNameMax),
    weight: zod.number().min(1).max(updateEmptyLegPassengerBodyWeightMax),
    gender: zod
      .enum(["male", "female"])
      .describe(
        "Operator manifest gender. Restricted to male\/female to match the\nmember profile gender field; the operator's compliance forms only\naccept these two buckets.\n",
      ),
    dob: zod.coerce.date(),
    notes: zod.string().max(updateEmptyLegPassengerBodyNotesMax).nullish(),
  })
  .describe(
    "Passenger payload submitted by the empty-leg queue winner. Mirrors\n`AddPassengerInput` exactly so the same form can be reused by the\nclient.\n",
  );
```

### 15. DELETE /api/empty-legs/{id}/passengers/{passengerId}

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: removeEmptyLegPassenger
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "passengerId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const RemoveEmptyLegPassengerParams = zod.object({
  id: zod.coerce.number(),
  passengerId: zod.coerce.number(),
});
```

### 16. POST /api/empty-legs/{id}/pets

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: addEmptyLegPet
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPetInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AddEmptyLegPetParams = zod.object({
  id: zod.coerce.number(),
});

export const AddEmptyLegPetBody = zod
  .object({
    breed: zod.string().min(1).max(addEmptyLegPetBodyBreedMax),
    weight: zod.number().min(1).max(addEmptyLegPetBodyWeightMax),
  })
  .describe(
    "Pet payload submitted by the empty-leg winner (or an admin on\ntheir behalf) — just weight and breed.\n",
  );
```

### 17. PATCH /api/empty-legs/{id}/pets/{petId}

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: updateEmptyLegPet
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "petId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPetInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const UpdateEmptyLegPetParams = zod.object({
  id: zod.coerce.number(),
  petId: zod.coerce.number(),
});

export const UpdateEmptyLegPetBody = zod
  .object({
    breed: zod.string().min(1).max(updateEmptyLegPetBodyBreedMax),
    weight: zod.number().min(1).max(updateEmptyLegPetBodyWeightMax),
  })
  .describe(
    "Pet payload submitted by the empty-leg winner (or an admin on\ntheir behalf) — just weight and breed.\n",
  );
```

### 18. DELETE /api/empty-legs/{id}/pets/{petId}

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: removeEmptyLegPet
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "petId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const RemoveEmptyLegPetParams = zod.object({
  id: zod.coerce.number(),
  petId: zod.coerce.number(),
});
```

### 19. PATCH /api/empty-legs/{id}/passengers/{passengerId}/weight

- Source: artifacts/api-server/src/routes/emptyLegPassengers.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: updateEmptyLegPassengerWeight
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "passengerId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/UpdateEmptyLegPassengerWeightInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLegPassengerListResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 parameters/body/nonpositive weight/blank required text; deleting own seat or weight-only editing guest =>400. 401; 403 open queue/not winner/locked manifest (lock on writes); 404 leg or target missing; passenger POST409 seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Published leg and closed queue required. Caller must be awarded passenger, else effective rank #1. Every mutation enforces override ?? (T-2h or sweep lock). Passenger/pet IDs are numeric and scoped to leg+owner. Full response {passengers,passengerCap,pets}. Weight units pounds; pets use breed+weight, not species/name/height/length. Pets do not consume seats. Passenger gender male/female; legacy response gender and missing lead-seat weight may be null. DOB date-only. POST passenger enforces cap transactionally. Passenger PATCH and pet PATCH require their full schemas, not sparse fields. Lead-seat updates sync profile; lead seat cannot be deleted. Weight-only PATCH is own-seat only. Mutations reset concierge completion.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const UpdateEmptyLegPassengerWeightParams = zod.object({
  id: zod.coerce.number(),
  passengerId: zod.coerce.number(),
});

export const UpdateEmptyLegPassengerWeightBody = zod
  .object({
    weight: zod.number().min(1).max(updateEmptyLegPassengerWeightBodyWeightMax),
  })
  .describe(
    "Capture the account holder's weight from the manifest when their\nprofile had none. Writes the manifest row AND back to the profile.\n",
  );
```

### 20. GET /api/trips

- Source: artifacts/api-server/src/routes/trips.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: listTrips
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/TripsListResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 401; 500 {error:"Failed to load trips"}. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Returns {current:TripDetail[],past:TripDetail[]}; empty arrays when none. leg.id and checklist.emptyLegId are numeric empty-leg identifiers. No separate trip UUID, flightId, external tripId or trip status field. Current departures sort ascending, past descending. Uses listOwnedLegIdsForUser (awarded/closed-queue ownership). Actual leg includes queueClosesAt; actual checklist includes awarded, both missing from baseline OpenAPI and corrected here. remainingSteps enum confirmed/fboVerified/manifestAck/policyAck. Boarding pass URL is null until awarded to caller; never log signed URLs.

### 21. POST /api/empty-legs/{id}/winner/confirm

- Source: artifacts/api-server/src/routes/queue.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: confirmEmptyLegWinner
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLeg"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 params;401;403 not current winner;404 flight/not in queue;409 queue open/already awarded/previously declined;500 Failed to build response after mutation. Error does not always mean mutation failed. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: No body. Effective winner re-ranked under lock after queue closes. Confirm atomically confirms/awards and notifies; already-awarded-to-self confirm is idempotent. Decline may promote/notify next winner; cannot decline already-awarded leg here. Returns enriched EmptyLeg, NOT {ok:true}. Pricing neutralized (0/null/null). Internal service error codes are NOT passed through by these handlers.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const ConfirmEmptyLegWinnerParams = zod.object({
  id: zod.coerce.number(),
});
```

### 22. POST /api/empty-legs/{id}/winner/decline

- Source: artifacts/api-server/src/routes/queue.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: declineEmptyLegWinner
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/EmptyLeg"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 params;401;403 not current winner;404 flight/not in queue;409 queue open/already awarded/previously declined;500 Failed to build response after mutation. Error does not always mean mutation failed. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: No body. Effective winner re-ranked under lock after queue closes. Confirm atomically confirms/awards and notifies; already-awarded-to-self confirm is idempotent. Decline may promote/notify next winner; cannot decline already-awarded leg here. Returns enriched EmptyLeg, NOT {ok:true}. Pricing neutralized (0/null/null). Internal service error codes are NOT passed through by these handlers.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const DeclineEmptyLegWinnerParams = zod.object({
  id: zod.coerce.number(),
});
```

### 23. POST /api/admin/empty-legs/{id}/passengers

- Source: artifacts/api-server/src/routes/admin.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: adminAddEmptyLegPassenger
- Authentication: Authenticated administrator OR concierge (requireAdminOrConcierge); ordinary member tokens forbidden.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPassengerInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/AdminEmptyLegManifestResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "409": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 validation/protected-row checks; 401 unauthenticated; 403 insufficient role; 404 missing leg/winner/passenger/pet; passenger add 409 capacity. Uncaught failure body UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Privileged manifest supplement. Resolves effective winner and edits that winner’s rows, not caller-selected user. Admin/concierge bypass member manifest-time lock. Passenger add enforces seat cap under leg lock; pets never count as seats. Names trim, weights validate; pets round weight. Returns admin manifest, not member manifest. DOB is ISO datetime after date-coercing generated response parser. Does not grant ordinary members admin functionality.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AdminAddEmptyLegPassengerParams = zod.object({
  id: zod.coerce.number(),
});

export const AdminAddEmptyLegPassengerBody = zod
  .object({
    firstName: zod
      .string()
      .min(1)
      .max(adminAddEmptyLegPassengerBodyFirstNameMax),
    middleName: zod
      .string()
      .max(adminAddEmptyLegPassengerBodyMiddleNameMax)
      .nullish(),
    lastName: zod.string().min(1).max(adminAddEmptyLegPassengerBodyLastNameMax),
    weight: zod.number().min(1).max(adminAddEmptyLegPassengerBodyWeightMax),
    gender: zod
      .enum(["male", "female"])
      .describe(
        "Operator manifest gender. Restricted to male\/female to match the\nmember profile gender field; the operator's compliance forms only\naccept these two buckets.\n",
      ),
    dob: zod.coerce.date(),
    notes: zod.string().max(adminAddEmptyLegPassengerBodyNotesMax).nullish(),
  })
  .describe(
    "Passenger payload submitted by the empty-leg queue winner. Mirrors\n`AddPassengerInput` exactly so the same form can be reused by the\nclient.\n",
  );
```

### 24. PATCH /api/admin/empty-legs/{id}/passengers/{passengerId}

- Source: artifacts/api-server/src/routes/admin.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: adminUpdateEmptyLegPassenger
- Authentication: Authenticated administrator OR concierge (requireAdminOrConcierge); ordinary member tokens forbidden.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "passengerId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPassengerInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/AdminEmptyLegManifestResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 validation/protected-row checks; 401 unauthenticated; 403 insufficient role; 404 missing leg/winner/passenger/pet; passenger add 409 capacity. Uncaught failure body UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Privileged manifest supplement. Resolves effective winner and edits that winner’s rows, not caller-selected user. Admin/concierge bypass member manifest-time lock. Passenger add enforces seat cap under leg lock; pets never count as seats. Names trim, weights validate; pets round weight. Returns admin manifest, not member manifest. DOB is ISO datetime after date-coercing generated response parser. Does not grant ordinary members admin functionality.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AdminUpdateEmptyLegPassengerParams = zod.object({
  id: zod.coerce.number(),
  passengerId: zod.coerce.number(),
});

export const AdminUpdateEmptyLegPassengerBody = zod
  .object({
    firstName: zod
      .string()
      .min(1)
      .max(adminUpdateEmptyLegPassengerBodyFirstNameMax),
    middleName: zod
      .string()
      .max(adminUpdateEmptyLegPassengerBodyMiddleNameMax)
      .nullish(),
    lastName: zod
      .string()
      .min(1)
      .max(adminUpdateEmptyLegPassengerBodyLastNameMax),
    weight: zod.number().min(1).max(adminUpdateEmptyLegPassengerBodyWeightMax),
    gender: zod
      .enum(["male", "female"])
      .describe(
        "Operator manifest gender. Restricted to male\/female to match the\nmember profile gender field; the operator's compliance forms only\naccept these two buckets.\n",
      ),
    dob: zod.coerce.date(),
    notes: zod.string().max(adminUpdateEmptyLegPassengerBodyNotesMax).nullish(),
  })
  .describe(
    "Passenger payload submitted by the empty-leg queue winner. Mirrors\n`AddPassengerInput` exactly so the same form can be reused by the\nclient.\n",
  );
```

### 25. DELETE /api/admin/empty-legs/{id}/passengers/{passengerId}

- Source: artifacts/api-server/src/routes/admin.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: adminRemoveEmptyLegPassenger
- Authentication: Authenticated administrator OR concierge (requireAdminOrConcierge); ordinary member tokens forbidden.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "passengerId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/AdminEmptyLegManifestResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 validation/protected-row checks; 401 unauthenticated; 403 insufficient role; 404 missing leg/winner/passenger/pet; passenger add 409 capacity. Uncaught failure body UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Privileged manifest supplement. Resolves effective winner and edits that winner’s rows, not caller-selected user. Admin/concierge bypass member manifest-time lock. Passenger add enforces seat cap under leg lock; pets never count as seats. Names trim, weights validate; pets round weight. Returns admin manifest, not member manifest. DOB is ISO datetime after date-coercing generated response parser. Does not grant ordinary members admin functionality.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AdminRemoveEmptyLegPassengerParams = zod.object({
  id: zod.coerce.number(),
  passengerId: zod.coerce.number(),
});
```

### 26. POST /api/admin/empty-legs/{id}/pets

- Source: artifacts/api-server/src/routes/admin.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: adminAddEmptyLegPet
- Authentication: Authenticated administrator OR concierge (requireAdminOrConcierge); ordinary member tokens forbidden.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPetInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/AdminEmptyLegManifestResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "409": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 validation/protected-row checks; 401 unauthenticated; 403 insufficient role; 404 missing leg/winner/passenger/pet; passenger add 409 capacity. Uncaught failure body UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Privileged manifest supplement. Resolves effective winner and edits that winner’s rows, not caller-selected user. Admin/concierge bypass member manifest-time lock. Passenger add enforces seat cap under leg lock; pets never count as seats. Names trim, weights validate; pets round weight. Returns admin manifest, not member manifest. DOB is ISO datetime after date-coercing generated response parser. Does not grant ordinary members admin functionality.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AdminAddEmptyLegPetParams = zod.object({
  id: zod.coerce.number(),
});

export const AdminAddEmptyLegPetBody = zod
  .object({
    breed: zod.string().min(1).max(adminAddEmptyLegPetBodyBreedMax),
    weight: zod.number().min(1).max(adminAddEmptyLegPetBodyWeightMax),
  })
  .describe(
    "Pet payload submitted by the empty-leg winner (or an admin on\ntheir behalf) — just weight and breed.\n",
  );
```

### 27. PATCH /api/admin/empty-legs/{id}/pets/{petId}

- Source: artifacts/api-server/src/routes/admin.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: adminUpdateEmptyLegPet
- Authentication: Authenticated administrator OR concierge (requireAdminOrConcierge); ordinary member tokens forbidden.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "petId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddEmptyLegPetInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/AdminEmptyLegManifestResponse"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 validation/protected-row checks; 401 unauthenticated; 403 insufficient role; 404 missing leg/winner/passenger/pet; passenger add 409 capacity. Uncaught failure body UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Privileged manifest supplement. Resolves effective winner and edits that winner’s rows, not caller-selected user. Admin/concierge bypass member manifest-time lock. Passenger add enforces seat cap under leg lock; pets never count as seats. Names trim, weights validate; pets round weight. Returns admin manifest, not member manifest. DOB is ISO datetime after date-coercing generated response parser. Does not grant ordinary members admin functionality.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AdminUpdateEmptyLegPetParams = zod.object({
  id: zod.coerce.number(),
  petId: zod.coerce.number(),
});

export const AdminUpdateEmptyLegPetBody = zod
  .object({
    breed: zod.string().min(1).max(adminUpdateEmptyLegPetBodyBreedMax),
    weight: zod.number().min(1).max(adminUpdateEmptyLegPetBodyWeightMax),
  })
  .describe(
    "Pet payload submitted by the empty-leg winner (or an admin on\ntheir behalf) — just weight and breed.\n",
  );
```

### 28. DELETE /api/admin/empty-legs/{id}/pets/{petId}

- Source: artifacts/api-server/src/routes/admin.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: adminRemoveEmptyLegPet
- Authentication: Authenticated administrator OR concierge (requireAdminOrConcierge); ordinary member tokens forbidden.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "petId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/AdminEmptyLegManifestResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 validation/protected-row checks; 401 unauthenticated; 403 insufficient role; 404 missing leg/winner/passenger/pet; passenger add 409 capacity. Uncaught failure body UNKNOWN. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: Privileged manifest supplement. Resolves effective winner and edits that winner’s rows, not caller-selected user. Admin/concierge bypass member manifest-time lock. Passenger add enforces seat cap under leg lock; pets never count as seats. Names trim, weights validate; pets round weight. Returns admin manifest, not member manifest. DOB is ISO datetime after date-coercing generated response parser. Does not grant ordinary members admin functionality.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AdminRemoveEmptyLegPetParams = zod.object({
  id: zod.coerce.number(),
  petId: zod.coerce.number(),
});
```

### 29. POST /api/charter-requests/{id}/passengers

- Source: artifacts/api-server/src/routes/charter.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: addCharterPassenger
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: Required body.

```json
{
  "$ref": "#/components/schemas/AddPassengerInput"
}
```

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/CharterRequest"
  },
  "400": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "409": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 schema/params/blank names/nonpositive weight; 401; 403 not owner; 404 missing request/passenger; 409 blocked status or seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: id is numeric charter request ID, NOT empty-leg ID. Caller must own request. Parent status rechecked under lock: cancelled/declined/quote_failed block modification with 409. Add requires full passenger payload, cap=passengerCount. Returns full owner-view CharterRequest, not empty-leg manifest. Excludes clerkUserId,email,hamiltonWholesaleUsd,markupPct. No separate charter pet route found.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const AddCharterPassengerParams = zod.object({
  id: zod.coerce.number(),
});

export const AddCharterPassengerBody = zod
  .object({
    firstName: zod.string().min(1).max(addCharterPassengerBodyFirstNameMax),
    middleName: zod
      .string()
      .max(addCharterPassengerBodyMiddleNameMax)
      .nullish(),
    lastName: zod.string().min(1).max(addCharterPassengerBodyLastNameMax),
    weight: zod
      .number()
      .min(1)
      .max(addCharterPassengerBodyWeightMax)
      .describe("Passenger weight in pounds."),
    gender: zod
      .enum(["male", "female"])
      .describe(
        "Operator manifest gender. Restricted to male\/female to match the\nmember profile gender field; the operator's compliance forms only\naccept these two buckets.\n",
      ),
    dob: zod.coerce.date().describe("Date of birth (YYYY-MM-DD)."),
    notes: zod.string().max(addCharterPassengerBodyNotesMax).nullish(),
  })
  .describe(
    "New-shape passenger payload. All fields except `middleName` and\n`notes` are required so the operator gets the full manifest data.\nThe server derives `fullName` from the name parts on insert.\n",
  );
```

### 30. DELETE /api/charter-requests/{id}/passengers/{passengerId}

- Source: artifacts/api-server/src/routes/charter.ts; shared schemas lib/api-zod/src/generated/api.ts.
- Operation: removeCharterPassenger
- Authentication: Clerk Bearer session required; unresolved identity yields 401.
- Evidence: VERIFIED FROM SOURCE; production runtime NO.
- Path/query parameters:

```json
[
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  },
  {
    "name": "passengerId",
    "in": "path",
    "required": true,
    "schema": {
      "type": "integer"
    }
  }
]
```

- Request JSON schema: No request body consumed.

- Response JSON schemas by status (shared declarations; see additional runtime errors below):

```json
{
  "200": {
    "$ref": "#/components/schemas/CharterRequest"
  },
  "401": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "403": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "404": {
    "$ref": "#/components/schemas/ErrorResponse"
  },
  "409": {
    "$ref": "#/components/schemas/ErrorResponse"
  }
}
```

- Error cases: 400 schema/params/blank names/nonpositive weight; 401; 403 not owner; 404 missing request/passenger; 409 blocked status or seat cap. Explicit route errors follow SourceError unless stated otherwise.
- Restrictions and implementation details: id is numeric charter request ID, NOT empty-leg ID. Caller must own request. Parent status rechecked under lock: cancelled/declined/quote_failed block modification with 409. Add requires full passenger payload, cap=passengerCount. Returns full owner-view CharterRequest, not empty-leg manifest. Excludes clerkUserId,email,hamiltonWholesaleUsd,markupPct. No separate charter pet route found.

Exact generated input-validator excerpts (constants resolved in appendix; hand-written handler overrides noted above):

```ts
export const RemoveCharterPassengerParams = zod.object({
  id: zod.coerce.number(),
  passengerId: zod.coerce.number(),
});
```

## Self-contained JSON schema registry

All #/components/schemas references resolve inside this object. Required lists distinguish omission from nullability. Source corrections described above supersede baseline OpenAPI.

```json
{
  "components": {
    "schemas": {
      "AddEmptyLegPassengerInput": {
        "type": "object",
        "properties": {
          "firstName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "middleName": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 100
          },
          "lastName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "weight": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000
          },
          "gender": {
            "$ref": "#/components/schemas/PassengerGender"
          },
          "dob": {
            "type": "string",
            "format": "date"
          },
          "notes": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 500
          }
        },
        "required": [
          "firstName",
          "lastName",
          "weight",
          "gender",
          "dob"
        ]
      },
      "AddEmptyLegPetInput": {
        "type": "object",
        "properties": {
          "breed": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "weight": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000
          }
        },
        "required": [
          "breed",
          "weight"
        ]
      },
      "AddPassengerInput": {
        "type": "object",
        "properties": {
          "firstName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "middleName": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 100
          },
          "lastName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "weight": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000
          },
          "gender": {
            "$ref": "#/components/schemas/PassengerGender"
          },
          "dob": {
            "type": "string",
            "format": "date"
          },
          "notes": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 500
          }
        },
        "required": [
          "firstName",
          "lastName",
          "weight",
          "gender",
          "dob"
        ]
      },
      "AdminEmptyLegManifestResponse": {
        "type": "object",
        "properties": {
          "hasWinner": {
            "type": "boolean"
          },
          "winnerClerkUserId": {
            "type": [
              "string",
              "null"
            ]
          },
          "winnerDisplayName": {
            "type": [
              "string",
              "null"
            ]
          },
          "passengers": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/AdminWinnerPassenger"
            }
          },
          "passengerCap": {
            "type": "integer"
          },
          "pets": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/EmptyLegPet"
            }
          }
        },
        "required": [
          "hasWinner",
          "winnerClerkUserId",
          "winnerDisplayName",
          "passengers",
          "passengerCap",
          "pets"
        ]
      },
      "AdminWinnerPassenger": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "fullName": {
            "type": "string"
          },
          "firstName": {
            "type": "string"
          },
          "middleName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastName": {
            "type": "string"
          },
          "weight": {
            "type": [
              "integer",
              "null"
            ]
          },
          "isAccountHolder": {
            "type": "boolean"
          },
          "gender": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/PassengerGender"
              },
              {
                "type": "null"
              }
            ]
          },
          "dob": {
            "type": "string",
            "format": "date-time"
          },
          "notes": {
            "type": [
              "string",
              "null"
            ]
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "fullName",
          "firstName",
          "lastName",
          "weight",
          "isAccountHolder",
          "gender",
          "dob",
          "createdAt"
        ]
      },
      "BillingAddress": {
        "type": "object",
        "properties": {
          "line1": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "line2": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 200
          },
          "city": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "region": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "postalCode": {
            "type": "string",
            "minLength": 1,
            "maxLength": 20
          },
          "country": {
            "type": "string",
            "minLength": 2,
            "maxLength": 2
          }
        },
        "required": [
          "line1",
          "city",
          "region",
          "postalCode",
          "country"
        ]
      },
      "CharterRequest": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "tripType": {
            "$ref": "#/components/schemas/CharterTripType"
          },
          "originAirport": {
            "type": "string"
          },
          "destinationAirport": {
            "type": "string"
          },
          "passengerCount": {
            "type": "integer"
          },
          "departureDate": {
            "type": "string",
            "format": "date-time"
          },
          "returnDate": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "status": {
            "$ref": "#/components/schemas/CharterStatus"
          },
          "tierAtQuote": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "base",
              "plus",
              null
            ]
          },
          "basePriceUsd": {
            "type": [
              "number",
              "null"
            ]
          },
          "taxPriceUsd": {
            "type": [
              "number",
              "null"
            ]
          },
          "totalPriceUsd": {
            "type": [
              "number",
              "null"
            ]
          },
          "adminNotes": {
            "type": [
              "string",
              "null"
            ]
          },
          "quotedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "bookingRequestedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "confirmedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "declinedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "checkedOutAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "cancelledAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "tailNumber": {
            "type": [
              "string",
              "null"
            ]
          },
          "originFboName": {
            "type": [
              "string",
              "null"
            ]
          },
          "originFboAddress": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationFboName": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationFboAddress": {
            "type": [
              "string",
              "null"
            ]
          },
          "transportationNotes": {
            "type": [
              "string",
              "null"
            ]
          },
          "cateringNotes": {
            "type": [
              "string",
              "null"
            ]
          },
          "passengers": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Passenger"
            }
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "tripType",
          "originAirport",
          "destinationAirport",
          "passengerCount",
          "departureDate",
          "status",
          "passengers",
          "createdAt",
          "updatedAt"
        ]
      },
      "CharterStatus": {
        "type": "string",
        "enum": [
          "quoted",
          "booking_requested",
          "confirmed",
          "checked_out",
          "quote_failed",
          "declined",
          "cancelled"
        ]
      },
      "CharterTripType": {
        "type": "string",
        "enum": [
          "one_way",
          "round_trip"
        ]
      },
      "CheckPhoneVerificationRequest": {
        "type": "object",
        "required": [
          "phoneE164",
          "code"
        ],
        "properties": {
          "phoneE164": {
            "type": "string",
            "minLength": 8,
            "maxLength": 16
          },
          "code": {
            "type": "string",
            "pattern": "^[0-9]{6}$"
          }
        }
      },
      "CurrentUser": {
        "type": "object",
        "properties": {
          "isAuthenticated": {
            "type": "boolean"
          },
          "isAdmin": {
            "type": "boolean"
          },
          "isConcierge": {
            "type": "boolean"
          },
          "isMember": {
            "type": "boolean"
          },
          "memberTier": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "base",
              "plus",
              null
            ]
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "firstName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastName": {
            "type": [
              "string",
              "null"
            ]
          },
          "isProfileComplete": {
            "type": "boolean"
          },
          "needsPlanDecision": {
            "type": "boolean"
          },
          "needsSignupPhone": {
            "type": "boolean"
          },
          "impersonation": {
            "oneOf": [
              {
                "type": "null"
              },
              {
                "$ref": "#/components/schemas/ImpersonationInfo"
              }
            ]
          }
        },
        "required": [
          "isAuthenticated",
          "isAdmin",
          "isConcierge",
          "isMember",
          "memberTier",
          "isProfileComplete",
          "needsPlanDecision",
          "needsSignupPhone"
        ]
      },
      "EmptyLeg": {
        "type": "object",
        "properties": {
          "publicationHoldReason": {
            "type": [
              "string",
              "null"
            ]
          },
          "publicationReleaseAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "publicationDistanceNm": {
            "type": [
              "number",
              "null"
            ]
          },
          "publicationScheduled": {
            "type": "boolean"
          },
          "id": {
            "type": "integer"
          },
          "tripId": {
            "type": [
              "string",
              "null"
            ]
          },
          "icsUid": {
            "type": [
              "string",
              "null"
            ]
          },
          "originAirport": {
            "type": "string"
          },
          "originCity": {
            "type": [
              "string",
              "null"
            ]
          },
          "originTz": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationAirport": {
            "type": "string"
          },
          "destinationCity": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationTz": {
            "type": [
              "string",
              "null"
            ]
          },
          "departureTime": {
            "type": "string",
            "format": "date-time"
          },
          "arrivalTime": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "manualSchedule": {
            "type": "boolean"
          },
          "queueClosesAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "aircraftType": {
            "type": [
              "string",
              "null"
            ]
          },
          "tailNumber": {
            "type": [
              "string",
              "null"
            ]
          },
          "aircraftTypeName": {
            "type": [
              "string",
              "null"
            ]
          },
          "aircraftTypeCode": {
            "type": [
              "string",
              "null"
            ]
          },
          "aircraftGalleryUrls": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "aircraftGalleryAlts": {
            "type": "array",
            "items": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "aircraftTailPhotoSlot": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "exterior_1",
              "exterior_2",
              "exterior_3",
              null
            ]
          },
          "aircraftTailUploadedSlots": {
            "type": [
              "array",
              "null"
            ],
            "items": {
              "type": "string",
              "enum": [
                "exterior_1",
                "exterior_2",
                "exterior_3",
                "interior"
              ]
            }
          },
          "durationHours": {
            "type": [
              "number",
              "null"
            ]
          },
          "pricePerHour": {
            "type": "integer"
          },
          "totalPrice": {
            "type": [
              "integer",
              "null"
            ]
          },
          "msrpUsd": {
            "type": [
              "number",
              "null"
            ]
          },
          "msrpFetchedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "changeFlagSeverity": {
            "type": "string",
            "enum": [
              "none",
              "caution",
              "alert"
            ]
          },
          "changeFlagSummary": {
            "type": [
              "string",
              "null"
            ]
          },
          "changeFlagDetails": {
            "type": [
              "object",
              "null"
            ]
          },
          "lastCheckedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "flaggedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "queueCount": {
            "type": "integer"
          },
          "memberQueueCount": {
            "type": "integer"
          },
          "userInQueue": {
            "type": "boolean"
          },
          "viewerQueuePosition": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1
          },
          "lockedForFreeUsers": {
            "type": "boolean"
          },
          "lineSkipPriceUsd": {
            "type": "integer"
          },
          "lineSkipSold": {
            "type": "boolean"
          },
          "viewerHasLineSkip": {
            "type": "boolean"
          },
          "internationalPassPriceUsd": {
            "type": "integer"
          },
          "internationalPassRequired": {
            "type": "boolean"
          },
          "viewerHasInternationalPass": {
            "type": "boolean"
          },
          "viewerIsBookedPassenger": {
            "type": "boolean"
          },
          "viewerIsEffectiveWinner": {
            "type": "boolean"
          },
          "viewerConfirmationStatus": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "pending",
              "confirmed",
              "declined",
              null
            ]
          },
          "awardedToClerkUserId": {
            "type": [
              "string",
              "null"
            ]
          },
          "awardedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "winnerDisplayName": {
            "type": [
              "string",
              "null"
            ]
          },
          "winnerConfirmationStatus": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "pending",
              "confirmed",
              "declined",
              null
            ]
          },
          "originFboName": {
            "type": [
              "string",
              "null"
            ]
          },
          "originFboAddress": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationFboName": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationFboAddress": {
            "type": [
              "string",
              "null"
            ]
          },
          "isInternational": {
            "type": "boolean"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "published",
              "cancelled"
            ]
          },
          "isProtected": {
            "type": "boolean"
          },
          "suppressPublishNotifications": {
            "type": "boolean"
          },
          "cancelledAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "cancellationReason": {
            "type": [
              "string",
              "null"
            ]
          },
          "cancelledByClerkUserId": {
            "type": [
              "string",
              "null"
            ]
          },
          "cancelledByKind": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "admin",
              "system",
              null
            ]
          },
          "rawSummary": {
            "type": [
              "string",
              "null"
            ]
          },
          "notes": {
            "type": [
              "string",
              "null"
            ]
          },
          "photoKey": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "photo1",
              "photo2",
              "photo3",
              "photo4",
              "photo5",
              null
            ]
          },
          "aircraftTypeId": {
            "type": [
              "integer",
              "null"
            ]
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "originAirport",
          "destinationAirport",
          "departureTime",
          "isInternational",
          "status",
          "pricePerHour",
          "queueCount",
          "memberQueueCount",
          "userInQueue",
          "lockedForFreeUsers",
          "lineSkipPriceUsd",
          "lineSkipSold",
          "viewerHasLineSkip",
          "internationalPassPriceUsd",
          "internationalPassRequired",
          "viewerHasInternationalPass",
          "viewerIsEffectiveWinner",
          "changeFlagSeverity",
          "aircraftGalleryUrls",
          "aircraftGalleryAlts",
          "createdAt",
          "updatedAt"
        ]
      },
      "EmptyLegPassenger": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "emptyLegId": {
            "type": "integer"
          },
          "fullName": {
            "type": "string"
          },
          "firstName": {
            "type": "string"
          },
          "middleName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastName": {
            "type": "string"
          },
          "weight": {
            "type": [
              "integer",
              "null"
            ]
          },
          "isAccountHolder": {
            "type": "boolean"
          },
          "gender": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/PassengerGender"
              },
              {
                "type": "null"
              }
            ]
          },
          "dob": {
            "type": "string",
            "format": "date"
          },
          "notes": {
            "type": [
              "string",
              "null"
            ]
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "emptyLegId",
          "fullName",
          "firstName",
          "lastName",
          "weight",
          "isAccountHolder",
          "gender",
          "dob",
          "createdAt"
        ]
      },
      "EmptyLegPassengerListResponse": {
        "type": "object",
        "properties": {
          "passengers": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/EmptyLegPassenger"
            }
          },
          "passengerCap": {
            "type": "integer"
          },
          "pets": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/EmptyLegPet"
            }
          }
        },
        "required": [
          "passengers",
          "passengerCap",
          "pets"
        ]
      },
      "EmptyLegPet": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "emptyLegId": {
            "type": "integer"
          },
          "breed": {
            "type": "string"
          },
          "weight": {
            "type": "integer"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "emptyLegId",
          "breed",
          "weight",
          "createdAt"
        ]
      },
      "ErrorResponse": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "code": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "error"
        ]
      },
      "ImpersonationInfo": {
        "type": "object",
        "properties": {
          "active": {
            "type": "boolean"
          },
          "adminClerkUserId": {
            "type": "string"
          },
          "adminEmail": {
            "type": [
              "string",
              "null"
            ]
          },
          "targetClerkUserId": {
            "type": "string"
          },
          "targetEmail": {
            "type": [
              "string",
              "null"
            ]
          },
          "targetName": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "active",
          "adminClerkUserId",
          "adminEmail",
          "targetClerkUserId",
          "targetEmail",
          "targetName"
        ]
      },
      "JoinEmptyLegQueueConflictResponse": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "code": {
            "type": [
              "string",
              "null"
            ]
          },
          "conflict": {
            "type": "object",
            "properties": {
              "legId": {
                "type": "integer"
              },
              "originAirport": {
                "type": "string"
              },
              "destinationAirport": {
                "type": "string"
              },
              "departureTime": {
                "type": "string",
                "format": "date-time"
              },
              "departureTz": {
                "type": "string"
              },
              "departureLocalDate": {
                "type": "string"
              }
            },
            "required": [
              "legId",
              "originAirport",
              "destinationAirport",
              "departureTime",
              "departureTz",
              "departureLocalDate"
            ]
          }
        },
        "required": [
          "error"
        ]
      },
      "JoinEmptyLegQueueRequest": {
        "type": "object",
        "properties": {
          "internationalPassAuthorized": {
            "type": "boolean"
          },
          "useInternationalPassCredit": {
            "type": "boolean"
          }
        }
      },
      "Membership": {
        "type": "object",
        "properties": {
          "isMember": {
            "type": "boolean"
          },
          "tier": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "base",
              "plus",
              null
            ]
          },
          "status": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "active",
              "canceled",
              "expired",
              "pending_payment",
              null
            ]
          },
          "cancelAtPeriodEnd": {
            "type": "boolean"
          },
          "currentPeriodStart": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "currentPeriodEnd": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "startedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "canceledAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "paymentStatus": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "none",
              "pending",
              "succeeded",
              "failed",
              null
            ]
          },
          "paymentMethod": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/PaymentMethodOnFile"
              },
              {
                "type": "null"
              }
            ]
          },
          "scheduledTierChange": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/ScheduledTierChange"
              },
              {
                "type": "null"
              }
            ]
          },
          "recentEvents": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SubscriptionEvent"
            }
          },
          "lastPaidAmountCents": {
            "type": [
              "integer",
              "null"
            ]
          },
          "lastDiscountPercent": {
            "type": [
              "integer",
              "null"
            ]
          },
          "metaPurchase": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/MetaPurchaseConversion"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "isMember",
          "tier",
          "cancelAtPeriodEnd",
          "recentEvents"
        ]
      },
      "MetaPurchaseConversion": {
        "type": "object",
        "properties": {
          "eventId": {
            "type": "string"
          },
          "valueCents": {
            "type": [
              "integer",
              "null"
            ]
          },
          "currency": {
            "type": "string"
          }
        },
        "required": [
          "eventId",
          "currency"
        ]
      },
      "NotificationChannel": {
        "type": "string",
        "enum": [
          "email",
          "sms",
          "both"
        ]
      },
      "NotificationPrefs": {
        "type": "object",
        "properties": {
          "mode": {
            "type": "string",
            "enum": [
              false,
              "all",
              "specific"
            ]
          },
          "allChannels": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/NotificationChannel"
              },
              {
                "type": "null"
              }
            ]
          },
          "emptyLegHomeAirport": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/NotificationChannel"
              },
              {
                "type": "null"
              }
            ]
          },
          "departingFavorite": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/NotificationChannel"
              },
              {
                "type": "null"
              }
            ]
          },
          "arrivingFavorite": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/NotificationChannel"
              },
              {
                "type": "null"
              }
            ]
          },
          "queueUpdates": {
            "$ref": "#/components/schemas/NotificationChannel"
          },
          "winningNotifications": {
            "$ref": "#/components/schemas/NotificationChannel"
          }
        },
        "required": [
          "mode",
          "allChannels",
          "emptyLegHomeAirport",
          "departingFavorite",
          "arrivingFavorite",
          "queueUpdates",
          "winningNotifications"
        ]
      },
      "Passenger": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "fullName": {
            "type": "string"
          },
          "firstName": {
            "type": [
              "string",
              "null"
            ]
          },
          "middleName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastName": {
            "type": [
              "string",
              "null"
            ]
          },
          "weight": {
            "type": [
              "integer",
              "null"
            ]
          },
          "gender": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/PassengerGender"
              },
              {
                "type": "null"
              }
            ]
          },
          "dob": {
            "type": [
              "string",
              "null"
            ],
            "format": "date"
          },
          "notes": {
            "type": [
              "string",
              "null"
            ]
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "fullName",
          "createdAt"
        ]
      },
      "PassengerGender": {
        "type": "string",
        "enum": [
          "male",
          "female"
        ]
      },
      "PaymentMethodOnFile": {
        "type": "object",
        "properties": {
          "brand": {
            "type": "string",
            "enum": [
              "visa",
              "mastercard",
              "amex",
              "discover",
              "diners",
              "jcb",
              "unionpay",
              "unknown"
            ]
          },
          "last4": {
            "type": "string"
          },
          "expMonth": {
            "type": "string"
          },
          "expYear": {
            "type": "string"
          },
          "billingName": {
            "type": "string"
          },
          "billingAddress": {
            "$ref": "#/components/schemas/BillingAddress"
          }
        },
        "required": [
          "brand",
          "last4",
          "expMonth",
          "expYear",
          "billingName",
          "billingAddress"
        ]
      },
      "PhoneVerificationRateLimitedResponse": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "reason": {
            "type": "string",
            "enum": [
              "phone_cooldown",
              "user_daily_limit",
              "wrong_code_lockout"
            ]
          },
          "retryAfterSeconds": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "error",
          "reason",
          "retryAfterSeconds"
        ]
      },
      "PhoneVerificationStartResult": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          },
          "cooldownSeconds": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "ok",
          "cooldownSeconds"
        ]
      },
      "PhoneVerificationStatusResult": {
        "type": "object",
        "properties": {
          "method": {
            "type": "string",
            "enum": [
              "pin",
              "legacy_reply"
            ]
          },
          "expiresAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "cooldownSeconds": {
            "type": "integer",
            "minimum": 0
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "verified",
              "expired",
              "none"
            ]
          },
          "clerkWarning": {
            "type": [
              "string",
              "null"
            ]
          },
          "profile": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/PhoneVerifiedProfile"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "method",
          "expiresAt",
          "cooldownSeconds",
          "status",
          "clerkWarning",
          "profile"
        ]
      },
      "PublicQueueEntry": {
        "type": "object",
        "properties": {
          "position": {
            "type": "integer"
          },
          "initials": {
            "type": "string"
          },
          "tier": {
            "type": "string",
            "enum": [
              "free",
              "base",
              "plus"
            ]
          },
          "hasLineSkip": {
            "type": "boolean"
          },
          "isViewer": {
            "type": "boolean"
          }
        },
        "required": [
          "position",
          "initials",
          "tier",
          "hasLineSkip",
          "isViewer"
        ]
      },
      "PurchaseLineSkipRequest": {
        "type": "object",
        "properties": {
          "useCredit": {
            "type": "boolean"
          }
        }
      },
      "QueueEntry": {
        "type": "object",
        "properties": {
          "emptyLegId": {
            "type": "integer"
          },
          "joinedAt": {
            "type": "string",
            "format": "date-time"
          },
          "position": {
            "type": "integer"
          },
          "queueCount": {
            "type": "integer"
          },
          "memberQueueCount": {
            "type": "integer"
          },
          "userInQueue": {
            "type": "boolean"
          },
          "userTier": {
            "type": "string",
            "enum": [
              "free",
              "base",
              "plus"
            ]
          },
          "userHasLineSkip": {
            "type": "boolean"
          },
          "userHasInternationalPass": {
            "type": "boolean"
          }
        },
        "required": [
          "emptyLegId",
          "joinedAt",
          "position",
          "queueCount",
          "memberQueueCount",
          "userInQueue",
          "userTier",
          "userHasLineSkip",
          "userHasInternationalPass"
        ]
      },
      "QueueStatus": {
        "type": "object",
        "properties": {
          "emptyLegId": {
            "type": "integer"
          },
          "queueCount": {
            "type": "integer"
          },
          "memberQueueCount": {
            "type": "integer"
          },
          "userInQueue": {
            "type": "boolean"
          },
          "lockedForFreeUsers": {
            "type": "boolean"
          }
        },
        "required": [
          "emptyLegId",
          "queueCount",
          "memberQueueCount",
          "userInQueue",
          "lockedForFreeUsers"
        ]
      },
      "ScheduledTierChange": {
        "type": "object",
        "properties": {
          "to": {
            "type": "string",
            "enum": [
              "base",
              "plus"
            ]
          },
          "at": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "to",
          "at"
        ]
      },
      "StartPhoneVerificationRequest": {
        "type": "object",
        "properties": {
          "countryIso2": {
            "type": "string",
            "minLength": 2,
            "maxLength": 2
          },
          "phoneE164": {
            "type": "string",
            "minLength": 8,
            "maxLength": 16
          }
        },
        "required": [
          "countryIso2",
          "phoneE164"
        ]
      },
      "SubscriptionEvent": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "eventType": {
            "$ref": "#/components/schemas/SubscriptionEventType"
          },
          "fromTier": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "base",
              "plus",
              null
            ]
          },
          "toTier": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "base",
              "plus",
              null
            ]
          },
          "source": {
            "type": "string",
            "enum": [
              "self",
              "admin",
              "system"
            ]
          },
          "occurredAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "eventType",
          "source",
          "occurredAt"
        ]
      },
      "SubscriptionEventType": {
        "type": "string",
        "enum": [
          "activated",
          "tier_changed",
          "scheduled_cancel",
          "resumed",
          "expired",
          "canceled",
          "plan_decision_none",
          "scheduled_tier_change",
          "scheduled_tier_change_canceled",
          "tos_accepted",
          "payment_method_updated",
          "period_end_changed",
          "refund_issued",
          "manual_charge_edited",
          "manual_charge_deleted",
          "epd_reconciled",
          "epd_webhook_received"
        ]
      },
      "TripChecklist": {
        "type": "object",
        "properties": {
          "emptyLegId": {
            "type": "integer"
          },
          "confirmedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "fboVerifiedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "manifestAckAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "policyAckAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "passLinkSentAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "manifestLockedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "manifestLocked": {
            "type": "boolean"
          },
          "boardingPassUrl": {
            "type": [
              "string",
              "null"
            ]
          },
          "remainingSteps": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "confirmed",
                "fboVerified",
                "manifestAck",
                "policyAck"
              ]
            }
          },
          "passengerCount": {
            "type": "integer"
          },
          "awarded": {
            "type": "boolean"
          }
        },
        "required": [
          "emptyLegId",
          "confirmedAt",
          "fboVerifiedAt",
          "manifestAckAt",
          "policyAckAt",
          "passLinkSentAt",
          "manifestLockedAt",
          "manifestLocked",
          "boardingPassUrl",
          "remainingSteps",
          "passengerCount",
          "awarded"
        ]
      },
      "TripDetail": {
        "type": "object",
        "properties": {
          "leg": {
            "$ref": "#/components/schemas/TripLegSummary"
          },
          "checklist": {
            "$ref": "#/components/schemas/TripChecklist"
          }
        },
        "required": [
          "leg",
          "checklist"
        ]
      },
      "TripLegSummary": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "originAirport": {
            "type": "string"
          },
          "destinationAirport": {
            "type": "string"
          },
          "originCity": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationCity": {
            "type": [
              "string",
              "null"
            ]
          },
          "departureTime": {
            "type": "string",
            "format": "date-time"
          },
          "arrivalTime": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "tailNumber": {
            "type": [
              "string",
              "null"
            ]
          },
          "aircraftType": {
            "type": [
              "string",
              "null"
            ]
          },
          "originFboName": {
            "type": [
              "string",
              "null"
            ]
          },
          "originFboAddress": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationFboName": {
            "type": [
              "string",
              "null"
            ]
          },
          "destinationFboAddress": {
            "type": [
              "string",
              "null"
            ]
          },
          "queueClosesAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "originAirport",
          "destinationAirport",
          "originCity",
          "destinationCity",
          "departureTime",
          "arrivalTime",
          "tailNumber",
          "aircraftType",
          "originFboName",
          "originFboAddress",
          "destinationFboName",
          "destinationFboAddress",
          "queueClosesAt"
        ]
      },
      "TripsListResponse": {
        "type": "object",
        "properties": {
          "current": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TripDetail"
            }
          },
          "past": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/TripDetail"
            }
          }
        },
        "required": [
          "current",
          "past"
        ]
      },
      "UpdateEmptyLegPassengerWeightInput": {
        "type": "object",
        "properties": {
          "weight": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000
          }
        },
        "required": [
          "weight"
        ]
      },
      "UpdateUserProfileRequest": {
        "type": "object",
        "properties": {
          "firstName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "lastName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "dob": {
            "type": "string",
            "format": "date"
          },
          "gender": {
            "$ref": "#/components/schemas/UserProfileGender"
          },
          "homeAirportCode": {
            "type": "string",
            "minLength": 3,
            "maxLength": 4
          },
          "favoriteCityKeys": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ]
          },
          "phoneCountry": {
            "type": [
              "string",
              "null"
            ]
          },
          "notificationPrefs": {
            "$ref": "#/components/schemas/NotificationPrefs"
          },
          "smsConsent": {
            "type": "boolean"
          },
          "email": {
            "type": "string",
            "format": "email",
            "minLength": 3,
            "maxLength": 254
          },
          "weightLbs": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1,
            "maximum": 1500
          }
        },
        "required": [
          "firstName",
          "lastName",
          "dob",
          "gender",
          "homeAirportCode",
          "favoriteCityKeys"
        ]
      },
      "UpgradeCreditBalances": {
        "type": "object",
        "properties": {
          "skipTheLine": {
            "type": "integer",
            "minimum": 0
          },
          "internationalPass": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "skipTheLine",
          "internationalPass"
        ]
      },
      "UserProfile": {
        "type": "object",
        "properties": {
          "firstName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastName": {
            "type": [
              "string",
              "null"
            ]
          },
          "dob": {
            "type": [
              "string",
              "null"
            ],
            "format": "date"
          },
          "gender": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "male",
              "female",
              null
            ]
          },
          "homeAirportCode": {
            "type": [
              "string",
              "null"
            ]
          },
          "homeAirportLabel": {
            "type": [
              "string",
              "null"
            ]
          },
          "favoriteAirportCodes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "favoriteAirportLabels": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "favoriteCityKeys": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "favoriteCityLabels": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ]
          },
          "phoneCountry": {
            "type": [
              "string",
              "null"
            ]
          },
          "phoneVerifiedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "phoneVerificationRequired": {
            "type": "boolean"
          },
          "notificationPrefs": {
            "$ref": "#/components/schemas/NotificationPrefs"
          },
          "smsConsent": {
            "type": "boolean"
          },
          "smsConsentAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "smsConsentRevokedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "emailLocked": {
            "type": "boolean"
          },
          "signupChannel": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "phone",
              "email",
              null
            ]
          },
          "isComplete": {
            "type": "boolean"
          },
          "upgradeCreditBalances": {
            "$ref": "#/components/schemas/UpgradeCreditBalances"
          },
          "weightLbs": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1,
            "maximum": 1500
          },
          "updatedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "firstName",
          "lastName",
          "dob",
          "gender",
          "homeAirportCode",
          "homeAirportLabel",
          "favoriteAirportCodes",
          "favoriteAirportLabels",
          "favoriteCityKeys",
          "favoriteCityLabels",
          "phoneE164",
          "phoneCountry",
          "phoneVerifiedAt",
          "phoneVerificationRequired",
          "notificationPrefs",
          "smsConsent",
          "smsConsentAt",
          "smsConsentRevokedAt",
          "email",
          "emailLocked",
          "signupChannel",
          "isComplete",
          "upgradeCreditBalances",
          "weightLbs"
        ]
      },
      "UserProfileGender": {
        "type": "string",
        "enum": [
          "male",
          "female"
        ]
      },
      "PhoneVerifiedProfile": {
        "type": "object",
        "properties": {
          "firstName": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastName": {
            "type": [
              "string",
              "null"
            ]
          },
          "dob": {
            "type": [
              "string",
              "null"
            ],
            "format": "date"
          },
          "gender": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "male",
              "female",
              null
            ]
          },
          "homeAirportCode": {
            "type": [
              "string",
              "null"
            ]
          },
          "homeAirportLabel": {
            "type": [
              "string",
              "null"
            ]
          },
          "favoriteAirportCodes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "favoriteAirportLabels": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "favoriteCityKeys": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "favoriteCityLabels": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "phoneE164": {
            "type": [
              "string",
              "null"
            ]
          },
          "phoneCountry": {
            "type": [
              "string",
              "null"
            ]
          },
          "phoneVerifiedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "phoneVerificationRequired": {
            "type": "boolean"
          },
          "notificationPrefs": {
            "$ref": "#/components/schemas/NotificationPrefs"
          },
          "smsConsent": {
            "type": "boolean"
          },
          "smsConsentAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "smsConsentRevokedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "emailLocked": {
            "type": "boolean"
          },
          "signupChannel": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "phone",
              "email",
              null
            ]
          },
          "isComplete": {
            "type": "boolean"
          },
          "weightLbs": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1,
            "maximum": 1500
          },
          "updatedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "firstName",
          "lastName",
          "dob",
          "gender",
          "homeAirportCode",
          "homeAirportLabel",
          "favoriteAirportCodes",
          "favoriteAirportLabels",
          "favoriteCityKeys",
          "favoriteCityLabels",
          "phoneE164",
          "phoneCountry",
          "phoneVerifiedAt",
          "phoneVerificationRequired",
          "notificationPrefs",
          "smsConsent",
          "smsConsentAt",
          "smsConsentRevokedAt",
          "email",
          "emailLocked",
          "signupChannel",
          "isComplete",
          "weightLbs",
          "updatedAt"
        ]
      },
      "SourceError": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "code": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          },
          "retryAfterSeconds": {
            "type": "number"
          },
          "unknownKeys": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "conflict": {
            "type": "object",
            "properties": {
              "legId": {
                "type": "integer"
              },
              "originAirport": {
                "type": "string"
              },
              "destinationAirport": {
                "type": "string"
              },
              "departureTime": {
                "type": "string",
                "format": "date-time"
              },
              "departureTz": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "departureLocalDate": {
                "type": "string"
              }
            },
            "required": [
              "legId",
              "originAirport",
              "destinationAirport",
              "departureTime",
              "departureTz",
              "departureLocalDate"
            ]
          }
        },
        "required": [
          "error"
        ]
      }
    }
  }
}
```

## Generated validator constants

```json
{
  "updateMyProfileBodyFirstNameMax": "80",
  "updateMyProfileBodyLastNameMax": "80",
  "updateMyProfileBodyHomeAirportCodeMin": "3",
  "updateMyProfileBodyHomeAirportCodeMax": "4",
  "updateMyProfileBodyFavoriteCityKeysItemMax": "64",
  "updateMyProfileBodyEmailMin": "3",
  "updateMyProfileBodyEmailMax": "254",
  "updateMyProfileBodyWeightLbsMax": "1500",
  "startPhoneVerificationBodyCountryIso2Min": "2",
  "startPhoneVerificationBodyCountryIso2Max": "2",
  "startPhoneVerificationBodyPhoneE164Min": "8",
  "startPhoneVerificationBodyPhoneE164Max": "16",
  "checkPhoneVerificationBodyPhoneE164Min": "8",
  "checkPhoneVerificationBodyPhoneE164Max": "16",
  "getPhoneVerificationStatusQueryPhoneE164Min": "8",
  "getPhoneVerificationStatusQueryPhoneE164Max": "16",
  "addEmptyLegPassengerBodyFirstNameMax": "100",
  "addEmptyLegPassengerBodyMiddleNameMax": "100",
  "addEmptyLegPassengerBodyLastNameMax": "100",
  "addEmptyLegPassengerBodyWeightMax": "1000",
  "addEmptyLegPassengerBodyNotesMax": "500",
  "updateEmptyLegPassengerBodyFirstNameMax": "100",
  "updateEmptyLegPassengerBodyMiddleNameMax": "100",
  "updateEmptyLegPassengerBodyLastNameMax": "100",
  "updateEmptyLegPassengerBodyWeightMax": "1000",
  "updateEmptyLegPassengerBodyNotesMax": "500",
  "addEmptyLegPetBodyBreedMax": "100",
  "addEmptyLegPetBodyWeightMax": "1000",
  "updateEmptyLegPetBodyBreedMax": "100",
  "updateEmptyLegPetBodyWeightMax": "1000",
  "updateEmptyLegPassengerWeightBodyWeightMax": "1000",
  "adminAddEmptyLegPassengerBodyFirstNameMax": "100",
  "adminAddEmptyLegPassengerBodyMiddleNameMax": "100",
  "adminAddEmptyLegPassengerBodyLastNameMax": "100",
  "adminAddEmptyLegPassengerBodyWeightMax": "1000",
  "adminAddEmptyLegPassengerBodyNotesMax": "500",
  "adminUpdateEmptyLegPassengerBodyFirstNameMax": "100",
  "adminUpdateEmptyLegPassengerBodyMiddleNameMax": "100",
  "adminUpdateEmptyLegPassengerBodyLastNameMax": "100",
  "adminUpdateEmptyLegPassengerBodyWeightMax": "1000",
  "adminUpdateEmptyLegPassengerBodyNotesMax": "500",
  "adminAddEmptyLegPetBodyBreedMax": "100",
  "adminAddEmptyLegPetBodyWeightMax": "1000",
  "adminUpdateEmptyLegPetBodyBreedMax": "100",
  "adminUpdateEmptyLegPetBodyWeightMax": "1000",
  "addCharterPassengerBodyFirstNameMax": "100",
  "addCharterPassengerBodyMiddleNameMax": "100",
  "addCharterPassengerBodyLastNameMax": "100",
  "addCharterPassengerBodyWeightMax": "1000",
  "addCharterPassengerBodyNotesMax": "500"
}
```

## Verification summary and unresolved items

- Endpoints documented: 30 (22 requested member endpoints + 6 privileged admin manifest routes + 2 charter passenger routes).
- Named schema definitions source-reviewed: 48 (46 shared definitions plus PhoneVerifiedProfile and SourceError); 38 generated path/body/query validator excerpts. Fifteen endpoint operations declare JSON request bodies.
- Production runtime tested: NO. Source-route mount prefix verified in app.ts and routes/index.ts.
- UNKNOWN: exact diff against the unavailable mobile-local contract; production credential parity/settings; deployed expired/malformed-token middleware responses; uncaught provider/database/framework error envelope and dynamic error text. No normal success field is deliberately replaced with an invented value.
- Backend source modified: NO. Authentication modified: NO. Only this documentation file was created. Git commit: NONE. Git push: NONE.

### Supporting source locations

- lib/api-spec/openapi.yaml; lib/api-zod/src/generated/api.ts — declared schema structure and actual generated validators.
- artifacts/api-server/src/app.ts; routes/index.ts — /api mount, Clerk middleware order.
- artifacts/api-server/src/lib/admin.ts; lib/clerkAuth.ts; lib/impersonation.ts — identity, pending sessions, effective identity.
- artifacts/api-server/src/lib/profile.ts — authoritative profile completeness.
- artifacts/api-server/src/lib/subscriptions.ts — membership snapshot/effective status.
- artifacts/api-server/src/lib/queueService.ts; routes/queue.ts — queue guards, actions, ranking and winner services.
- artifacts/api-server/src/lib/tripsService.ts — ownership selection and checklist projection.
- artifacts/api-server/src/lib/membership.ts — stripClientPricing.
- artifacts/api-server/src/lib/phoneVerification.ts; lib/quoConfig.ts — PIN validation, recovery, availability.
- lib/db/src/schema/charterRequests.ts — owner-view charter field/type cross-check.

The separate Expo client should import or regenerate from this source-derived contract only after reconciling the documented OpenAPI/runtime differences; blindly using its existing local spec or this repository's uncorrected shared descriptions is not sufficient.
