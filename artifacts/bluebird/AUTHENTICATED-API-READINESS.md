# Bluebird authenticated production API readiness

## Status

The dormant authenticated client now models the supplied member contract. It
is not connected to `AuthContext`, no screen constructs it, and production
member reads and writes remain unavailable until a verified Clerk token
provider and server token compatibility are established. In local flight-read
mode, existing demo screens continue using their existing local adapters. In
production mode, profile, membership, trips, queue actions, passenger/pet
records, and trip manifests remain unavailable instead of showing local demo
member data as production data.

## Clerk Expo SDK compatibility review (2026-10-12)

**Outcome: blocked; do not install or activate Clerk on the current baseline.**

| Package | Bluebird declaration | Lockfile version |
| --- | --- | --- |
| Expo | `~54.0.37` | `54.0.37` |
| React | `catalog:` (workspace catalog pins `19.1.0`) | `19.1.0` |
| React DOM | `catalog:` (workspace catalog pins `19.1.0`) | `19.1.0` |
| React Native | `0.81.5` | `0.81.5` |
| Expo Router | `~6.0.17` | `6.0.24` |
| `@types/react` | `~19.1.10` | `19.1.17` |

The latest stable `@clerk/expo@4.10.1` advertises Expo `>=54 <58`,
React `^18 || ^19`, and React Native `>=0.75`. Resolving it with pnpm 10.26.1
under this workspace's existing policy selects `@clerk/react@6.17.8`,
`@clerk/shared@4.40.0`, and `@clerk/clerk-js@6.39.0`. Both `@clerk/react` and
`@clerk/shared` require React/React DOM `^18 || ~19.0.3 || ~19.1.4 ||
~19.2.3 || ~19.3.0-0`; Bluebird's `19.1.0` is outside those peer ranges.
The SDK's broad top-level React peer therefore does not establish compatibility.

I also resolved `@clerk/expo@2.19.0`, whose Expo peer range is `>=53 <55` and
whose top-level React peer accepts React 19. Under the current workspace policy,
its transitive graph resolves `@clerk/react@5.54.0`,
`@clerk/clerk-js@5.128.0`, and `@clerk/shared@3.48.0`. The latter two have
React/React DOM peer ranges that exclude `19.1.0`; pnpm reports these as
unmet peers. This older candidate also reports a missing required
`expo-auth-session@>=5` peer in Bluebird. The currently declared
`expo-web-browser` does not satisfy that peer.

The workspace sets `strict-peer-dependencies=false`, so pnpm completes these
lockfile-only probes with warnings rather than rejecting them. The full
transitive peer warnings were reviewed manually; neither candidate is accepted.
No Clerk package or native auth dependency was added, and the app manifest and
lockfile remain unchanged. No dependency override, React/Expo upgrade, forced
install, or package-policy change was used.

### Isolated compatibility recheck (2026-10-12)

The registry still tags `@clerk/expo@4.10.1` as the latest stable release.
`4.10.2-canary.v20261009234607` is a prerelease and was not treated as an
officially supported candidate. The other stable major-line candidates checked
were `@clerk/expo@3.0.0` and `@clerk/expo@2.19.0`.

- `4.10.1` declares Expo `>=54 <58`, React/React DOM `^18 || ^19`, and React
  Native `>=0.75`. Its isolated graph resolved `@clerk/react@6.17.8`,
  `@clerk/shared@4.40.0`, and `@clerk/clerk-js@6.39.0`. Both React packages
  require `^18 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0`, excluding the
  pinned `19.1.0`.
- `3.0.0` declares Expo `>=53 <55`, React/React DOM `^18 || ^19`, and React
  Native `>=0.73`. It resolved the same Clerk React/shared/JS versions as
  `4.10.1`, with the same React and React DOM peer mismatch.
- `2.19.0` declares Expo `>=53 <55`, React/React DOM `^18 || ^19`, and React
  Native `>=0.73`. It resolved `@clerk/react@5.54.0`,
  `@clerk/shared@3.48.0`, and `@clerk/clerk-js@5.128.0`. The React package
  accepts `19.1.0`, but `shared` and `clerk-js` exclude it. This graph also
  reports missing Solana wallet peers (`@solana/web3.js` and `bs58`).

For the `4.10.1` probe, the official Expo 54 quickstart peers were added only
inside the disposable worktree: `expo-auth-session@7.0.11`,
`expo-crypto@15.0.9`, and `expo-secure-store@15.0.8`. These match Expo
54.0.37's bundled module map; Bluebird already has compatible
`expo-web-browser@15.0.11` and `expo-constants@18.0.14`. No native config
plugins were enabled. The dependency set was not copied to the active workspace.

The separate SDK 56 baseline-upgrade assessment below found a stable Expo
baseline whose React patch satisfies those Clerk transitive peers. That is a
compatibility candidate, not approval to migrate or activate authentication:
the candidate currently fails Bluebird's TypeScript check and has an official
Hermes memory regression relevant to Bluebird's Reanimated/Worklets usage.
Do not pin Clerk internals, override peers, or change the workspace policy to
make an incompatible graph appear compatible.

Clerk's [Expo Quickstart](https://clerk.com/docs/quickstarts/expo) recommends
installing `expo-secure-store`, `expo-auth-session`, `expo-crypto`, and
`expo-web-browser`, and configuring the `@clerk/expo` and
`expo-secure-store` plugins. Bluebird currently has only the last of those
packages (`expo-web-browser`). The quickstart also requires enabling Clerk's
Native API and configuring native app identifiers before making a native
production build. These are later activation prerequisites, not changes made
in this readiness review.

## Expo SDK baseline-upgrade assessment (Task 344, 2026-10-12)

**Recommendation: do not approve the SDK 56 migration or activate Clerk yet.**
SDK 56 is the smallest stable Expo baseline whose official React version fits
the current stable Clerk transitive peer ranges. The isolated dependency graph
resolves without Clerk peer conflicts, and startup tests, regression suites,
and Metro exports work, but the Bluebird
TypeScript check fails on app API changes, native builds and OAuth redirects
were not verified, and Expo documents a Hermes v1 memory regression in SDK 56
for apps using Reanimated/Worklets. Expo recommends SDK 57 for apps affected by
that regression; SDK 57 was not tested in this assessment.

### Candidate versions and peer evidence

Expo SDK 55 is not enough: the stable `expo@55.0.31` line's official baseline
is React/React DOM 19.2.0 and React Native 0.83, while the resolved stable
`@clerk/react@6.17.8` and
`@clerk/shared@4.40.0` both require React and React DOM `^18 || ~19.0.3 ||
~19.1.4 || ~19.2.3 || ~19.3.0-0`. The `~19.2.3` range excludes 19.2.0.
Expo SDK 56's bundled React 19.2.3 is the first tested stable Expo baseline in
that range.

| Package | SDK 56 candidate | Evidence |
| --- | --- | --- |
| Expo | `56.0.23` | Stable SDK 56 package and bundled module map |
| Expo CLI | `56.1.26` | Resolved stable CLI for the candidate |
| Expo Router | `56.2.21` (`~56.2.21`) | SDK 56 recommended version |
| React / React DOM | `19.2.3` / `19.2.3` | SDK 56 bundled versions; both satisfy Clerk transitive peers |
| React Native | `0.85.3` | SDK 56 bundled version; its peer requires React `^19.2.3` |
| React types / DOM types | `19.2.17` / `19.2.3` | SDK 56 `expo install --fix` recommendations |
| TypeScript | `6.0.3` | SDK 56 recommendation |
| Node.js | `24.13.0` | Candidate runtime satisfies React Native 0.85.3's declared Node engine |
| `@clerk/expo` | `4.10.1` | Latest stable package examined; prereleases were not considered |
| Clerk transitive graph | `@clerk/react@6.17.8`, `@clerk/shared@4.40.0`, `@clerk/clerk-js@6.39.0` | Resolved from the candidate lockfile |

Published `@clerk/expo@4.10.1` metadata declares Expo `>=54 <58`, React and
React DOM `^18 || ^19`, and React Native `>=0.75`. Its required Expo peers
include `expo-auth-session >=5`, `expo-crypto >=12`,
`expo-secure-store >=12.4.0`, `expo-web-browser >=12.5.0`, and
`expo-constants >=12`; the SDK 56 candidate installed compatible versions.
The published metadata marks passkey (`@clerk/expo-passkeys >=0.0.6`),
biometrics (`@clerk/expo-biometrics >=0.1.0`), Google sign-in
(`@clerk/expo-google-signin >=0.1.0`), Apple authentication
(`expo-apple-authentication >=7.0.0`), and local authentication
(`expo-local-authentication >=13.5.0`) as optional peers; none are needed for
this baseline compatibility probe.

The candidate also adopted SDK 56's recommended Expo/native module set. Key
resolved versions were `expo-auth-session@56.0.19`, `expo-crypto@56.0.5`,
`expo-secure-store@56.0.4`, `expo-web-browser@56.0.6`,
`expo-constants@56.0.27`, `expo-calendar@56.0.10`,
`expo-notifications@56.0.26`, `expo-file-system@56.0.11`,
`react-native-maps@1.27.2`, `react-native-reanimated@4.3.1`,
`react-native-worklets@0.8.3`, `react-native-gesture-handler@2.31.2`,
`react-native-keyboard-controller@1.21.6`,
`react-native-safe-area-context@5.7.0`, and `react-native-screens@4.26.2`.
`expo install --fix` additionally updated the SDK 56 packages for clipboard,
blur, font, glass effect, haptics, image, image picker, linear gradient,
linking, location, splash screen, status bar, symbols, system UI, SVG, and the
React type packages. The candidate's `expo install --check` reported all Expo
dependencies up to date.

### Router, app, and native readiness

Bluebird does not directly import `@react-navigation/*` from app code, so the
SDK 56 Router restriction on those external imports did not identify another
existing migration. However, the current tabs layout imports `Badge`, `Icon`,
and `Label` as named exports from `expo-router/unstable-native-tabs`; those
exports are absent in Router 56. The SDK 56 API documents
`NativeTabs.Trigger.Badge`, `NativeTabs.Trigger.Icon`, and
`NativeTabs.Trigger.Label` instead. This is a required navigation-file
migration, and a Metro export is not a substitute for the failed typecheck.

The current app config already uses the `bluebird` URL scheme, the Expo Router
plugin, and the New Architecture. It has no iOS `bundleIdentifier` or Android
`package`/`namespace`. Clerk's official Expo quickstart requires those native
identifiers, the `@clerk/expo` and `expo-secure-store` config plugins, and the
Clerk Native API for native integration; its hosted-auth callback is derived
from the identifiers. The documented SecureStore token cache is imported from
`@clerk/expo/token-cache`. These were assessed only: no Clerk plugin, provider,
token cache, callback, or production auth flow was configured or tested.

Clerk's documentation distinguishes hosted authentication (which can use Expo
Go) from prebuilt native components (which require a development build). Expo's
SDK 56 release notes state that SDK 56 Expo Go is not available in the Apple
App Store or Google Play Store, set minimum Xcode to 26.4 and iOS to 16.4, and
document a Hermes v1 memory increase when importing Reanimated or Worklets.
Bluebird uses both packages; the release notes recommend SDK 57 to resolve that
regression. The candidate's Metro exports do not verify native module linking,
SecureStore persistence, sign-in redirects, or device performance.

No `ios/` or `android/` project directories are present in the candidate, and
`xcodebuild`, `adb`, and `gradle` are unavailable in this environment.
Therefore no iOS or Android development build, simulator/device test,
SecureStore token restore, or OAuth redirect test could be performed. A
development build on supported native tooling remains mandatory before any
migration or activation approval.

### Candidate TypeScript blockers and React investigation

Expo SDK 56's TypeScript 6.0.3 first reports TS5101 for the existing
`baseUrl` setting in `artifacts/bluebird/tsconfig.json`. Removing `baseUrl` in
the disposable candidate only (rather than suppressing the deprecation) exposes
eight remaining errors across six files:

- `app/(tabs)/_layout.tsx`: `Badge`, `Icon`, and `Label` are no longer named
  exports from the SDK 56 native-tabs module.
- `app/(auth)/welcome-tour.tsx`, `app/(tabs)/discover/index.tsx`,
  `app/account/payment-methods.tsx`, `app/flight/[id].tsx`, and
  `app/referral.tsx`: React Native 0.85.3's `StyleSheet` type no longer exposes
  `absoluteFillObject`.

The earlier SDK 54 Clerk probe's `Cannot read properties of null (reading
'useState')` startup failure was not reproduced: the full-workspace SDK 56
candidate passed startup stability 5/5. React resolution was checked for the
app, React DOM, React Native, Expo Router, Clerk Expo/React, Reanimated, and
Worklets; all resolved the same React 19.2.3 file. No duplicate React was found
in this candidate, so the cause of the earlier SDK 54 probe failure is not
established. Do not treat that old error as an SDK 56 regression.

### Migration boundary and next steps

If a migration is separately approved, its minimum dependency/configuration
scope is `artifacts/bluebird/package.json` and `pnpm-lock.yaml`, using the
tested SDK 56 versions above and the SDK 56 native-module recommendations.
Keep React 19.2.3 local to Bluebird rather than changing the shared workspace
React catalog, which currently pins React 19.1.0 for other artifacts. The
Bluebird source migration must also update
`artifacts/bluebird/tsconfig.json`,
`artifacts/bluebird/app/(tabs)/_layout.tsx`, and the five style files listed
above. Before Clerk activation, separately configure approved native app
identifiers and the Clerk/SecureStore plugins in `artifacts/bluebird/app.json`,
then verify native development builds, SecureStore restoration, and hosted
OAuth redirects. Confirm backend verification of tokens from the same Clerk
instance before enabling authenticated production API calls.

**Approval boundary:** SDK 56 is the smallest stable peer-compatible candidate,
but it is not safe to approve as-is. First resolve the eight type errors and
assess the documented Hermes memory regression (including an SDK 57 candidate
if needed), then complete iOS/Android development-build and Clerk redirect
verification. No source dependency, app config, lockfile, screen, navigation,
API, or production authentication change was applied to the main workspace.

Sources: [Expo SDK 56 reference](https://docs.expo.dev/versions/v56.0.0/),
[Expo SDK 55 reference](https://docs.expo.dev/versions/v55.0.0/),
[Expo SDK 56 release notes](https://expo.dev/changelog/sdk-56),
[Expo Router SDK 56 reference](https://docs.expo.dev/versions/v56.0.0/sdk/router/),
[Expo Router native tabs](https://docs.expo.dev/versions/v56.0.0/sdk/router/native-tabs/),
[Expo Router SDK 55-to-56 migration](https://docs.expo.dev/router/migrate/sdk-55-to-56/),
[Clerk Expo quickstart](https://clerk.com/docs/expo/getting-started/quickstart),
and the published npm metadata for
[`@clerk/expo@4.10.1`](https://www.npmjs.com/package/@clerk/expo/v/4.10.1),
[`@clerk/react@6.17.8`](https://www.npmjs.com/package/@clerk/react/v/6.17.8),
and [`@clerk/shared@4.40.0`](https://www.npmjs.com/package/@clerk/shared/v/4.40.0).

## Dormant Clerk token bridge design

For a separately approved activation, configure only
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and use the publishable key for the exact
Clerk instance whose session tokens the production backend is configured to
verify. It is a public client key; never place a Clerk secret key in the mobile
app or an `EXPO_PUBLIC_` variable.

The future adapter should use Clerk's supported Expo `tokenCache` backed by
`expo-secure-store` rather than manually persisting session tokens. From a
Clerk-aware hook/context, implement `VerifiedProductionTokenProvider` by
calling Clerk's `useAuth().getToken()` for each explicit authenticated API
request. Do not cache a raw token in `AuthContext`, AsyncStorage, query keys, or
logs. The production API client accepts the provider only when explicitly
constructed; it is currently not constructed by any screen.

When Clerk is loaded but signed out, or `getToken()` returns `null`, the future
provider must return `null`; the client rejects the request as a token error
before calling fetch. An HTTP 401 is exposed as `session_expired`; the app must
discard that identity's authenticated data and require a valid signed-in
session before retrying. It must not fall back to the demo token or retry with
stale credentials. Authenticated query keys already include a member identity
(`productionAuthenticatedQueryKey(memberId, ...)`). When Clerk reports an
account change or sign-out, clear the prior identity's React Query data and
other member-scoped local state before exposing the new account.

This is a design only. `AuthContext` remains the active local/demo auth path;
no Clerk provider, Clerk token adapter, or authenticated production request is
connected. The checked-in API server still validates its own
`JWT_SECRET`/`SESSION_SECRET`-signed tokens, so server-side acceptance of
Clerk-issued tokens and Clerk-instance parity remain unverified blockers.

## Supported member contract

All paths below are relative to `https://bluebirdjets.com/api`. IDs in
`empty-legs` paths and their passenger/pet subpaths are positive safe numeric
IDs. Passenger and pet weights are whole pounds.

| Feature | Supported method and response |
| --- | --- |
| Signed-in state | `GET /me` returns the documented `CurrentUser`; a valid HTTP 200 response with `isAuthenticated: false` is an anonymous/signed-out result. No `userId` is added. |
| Profile | `GET /me/profile` and complete `PUT /me/profile`. The PUT requires first/last name, date-only DOB, gender, home airport, and at least one favorite city; optional phone, notification, consent, email, and `weightLbs` fields use source limits. Phone country is required when a phone is supplied. |
| Membership | `GET /membership` models the effective membership state, payment status, documented saved-payment projection, tier changes, and recent events. It is not the public plan catalog or a checkout API. |
| Trips | `GET /trips` returns `{ current, past }` of `{ leg, checklist }`. Leg IDs are numeric Empty Leg IDs; no trip UUID or booking-status field is modeled. |
| Queue | `GET /empty-legs/{id}/queue` returns the public queue array; `POST` joins and returns `QueueEntry`; `DELETE` leaves and returns `QueueStatus`. Join body only permits the documented international-pass authorization/credit options. |
| Skip line and winner | `POST /empty-legs/{id}/skip-line` accepts only optional `useCredit` and returns the neutralized `EmptyLeg`. Winner confirm and decline are `POST /empty-legs/{id}/winner/{confirm\|decline}` and also return `EmptyLeg`. |
| Empty Leg passenger/pet roster | `GET` and `POST /empty-legs/{id}/passengers`; `PATCH`/`DELETE /empty-legs/{id}/passengers/{passengerId}`; `POST /empty-legs/{id}/pets`; `PATCH`/`DELETE /empty-legs/{id}/pets/{petId}`; and `PATCH /empty-legs/{id}/passengers/{passengerId}/weight`. Both passenger and pet PATCH bodies include their full required input fields. |
| Phone ownership verification | `POST /me/phone-verification/start`, `POST /me/phone-verification/check`, and `GET /me/phone-verification/status?phoneE164=...` use the documented PIN status/results. This Bluebird Quo phone PIN is distinct from Clerk sign-in. |

The API server remains authoritative for eligibility and transitions. Queue
join requires a complete profile and active membership, an eligible published
open leg, and compliance with the one-queue-per-local-day/family rule. Members
cannot supply rank or tier. Skip-line eligibility and available credits are
rechecked by the server. A closed/departed queue cannot be left; a winner
declines instead. Winner confirmation is idempotent for the member already
awarded the leg; declining can promote the next winner. No method starts a
checkout or payment.

Public membership plans remain independent through the existing public plan
reader. The plan catalog can render without authenticated member data; purchase
behavior remains unavailable.

## Side effects and screen readiness

The client constructor is inert. Requests occur only when a caller explicitly
invokes a method and provides a non-empty token from `VerifiedProductionTokenProvider`.
The existing URL allowlist, bearer-only headers, omitted cookies, cancellation,
timeout, structured errors, response validation, and token secrecy are
preserved.

Three documented GETs can have side effects and are not called from app setup,
screen rendering, or readiness probes:

- `GET /me/profile` can synchronize verified phone fields into the profile.
- `GET /empty-legs/{id}/passengers` can insert the account-holder passenger.
- `GET /me/phone-verification/status` can update profile/Clerk verification
  data and synchronize a Sendblue contact.

The profile, membership, trips, queue, saved-passenger, and trip-passenger
screens remain guarded in production. They do not use this client and do not
show local demo account details as production data. Existing navigation and
screen appearance were not changed. The public plan catalog and public airport
search remain independent read-only flows. No phone verification, queue,
winner, passenger/pet mutation, SMS, or payment request was made.

## Remaining blockers and source limits

- Clerk is not activated in Bluebird's app session. `AuthContext` and demo
  tokens are not connected to the production client.
- The checked-in API server still signs/verifies its own `JWT_SECRET` or
  `SESSION_SECRET` tokens; it does not establish that the app's future Clerk
  session tokens are accepted. The supplied document describes Clerk bearer
  auth, but production Clerk instance parity and token compatibility remain
  unverified. The production UI stays disabled.
- The exact response body for expired/malformed-token middleware errors,
  production session lifetime, and some caught identity/provider failures are
  unknown. The client exposes HTTP 401 as a session-expiration/authentication
  error without assuming an error JSON shape.
- The supplied document's generated `NotificationPrefs.mode` schema lists
  boolean `false`, while its verified request-handler validator accepts the
  strings `off`, `all`, and `specific`. The client follows the handler's
  runtime strings; the source-document discrepancy remains unresolved.
- Admin/concierge manifest routes, charter passenger routes, trip cancellation,
  and a reusable saved-passenger library are not part of the supported member
  contract here and were not added.
- Contract shapes were source-reviewed only; no production runtime request
  was made.

## Verification

All authenticated-client cases use injected mock fetch only. Production-mode
browser checks intercept public endpoint fixtures and assert that authenticated
member endpoints are not requested. No production API was contacted.

Earlier SDK 54 Clerk-readiness checks (2026-10-12):

- Isolated worktree frozen-lockfile install for the latest stable candidate —
  completed, but emitted the documented unmet React/React DOM peer warnings;
  resolution success is not treated as compatibility.
- `pnpm --filter @workspace/bluebird exec expo install --check` in the isolated
  candidate worktree — passed; all installed Expo modules matched SDK 54.
- `pnpm run typecheck:libs` and `pnpm --filter @workspace/bluebird run typecheck`
  in the isolated candidate worktree — both passed.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` in the
  isolated candidate worktree — 15 passed, 0 failed; all requests used mocks.
- Temporary Metro import probe followed by `expo export --platform all` —
  web, iOS, and Android JS exports completed, and source maps contained
  `@clerk/expo@4.10.1`. The probe did not mount `ClerkProvider`.
- `pnpm --filter @workspace/bluebird run test:startup-stability` in the
  candidate worktree — 0 passed, 5 failed; every case hit
  `Cannot read properties of null (reading 'useState')` in the existing
  root-layout font hook before rendering. The same suite on the unchanged
  workspace passed 5/5. This was the SDK 54 probe; the SDK 56 candidate
  investigation and passing result are recorded above.
- `git diff --check` — passed in the isolated worktree. No native iOS/Android
  build or device sign-in test was available; Metro exports do not establish
  native compatibility.
- SDK 56 candidate `pnpm install --frozen-lockfile` — passed across all
  workspace packages under the existing package-manager policy; no peer
  override, force flag, or warning suppression was used.
- The initial filtered adds reported missing `@react-native/metro-config` and
  `@testing-library/dom` peers before the full-workspace frozen install. The
  completed frozen install emitted no peer-conflict warnings. Existing
  unapproved package scripts remained blocked by pnpm; the policy was not
  changed.
- SDK 56 candidate `pnpm --filter @workspace/bluebird exec expo install --check`
  — passed: dependencies up to date.
- SDK 56 candidate `pnpm run typecheck:libs` — passed.
- SDK 56 candidate `pnpm --filter @workspace/bluebird run typecheck` — failed:
  after removing deprecated `baseUrl` in the disposable candidate, 8 errors
  remained across 6 files (three obsolete native-tabs named exports and five
  `StyleSheet.absoluteFillObject` references).
- SDK 56 candidate `pnpm --filter @workspace/bluebird run test:production-auth-api`
  — 15 passed, 0 failed.
- SDK 56 candidate `pnpm --filter @workspace/bluebird run test:startup-stability`
  — 5 passed, 0 failed; the earlier null-`useState` error did not recur.
- SDK 56 candidate `pnpm --filter @workspace/bluebird run test:network-reliability`
  — 11 passed, 0 failed.
- SDK 56 candidate `pnpm --filter @workspace/bluebird run test:production-membership-plans`
  — passed.
- SDK 56 candidate `pnpm --filter @workspace/bluebird run test:production-queue-readiness`
  — 5 passed, 0 failed.
- SDK 56 candidate `pnpm --filter @workspace/bluebird run test:membership-plans`
  — 2 passed, 0 failed.
- SDK 56 candidate `pnpm --filter @workspace/bluebird exec playwright test tests/flight-passenger-flow.spec.mjs --workers=1`
  — 11 passed, 0 failed.
- SDK 56 candidate `expo export --platform web`, `--platform ios`, and
  `--platform android` — all completed. These are Metro/JS exports only, not
  native builds.
- SDK 56 candidate React path inspection — app, React DOM, React Native, Expo
  Router, Clerk Expo/React, Reanimated, and Worklets all resolved the same
  React 19.2.3 installation; no duplicate React was found.
- SDK 56 candidate `git diff --check` — passed. No native build was available:
  `ios/` and `android/` directories were absent and `xcodebuild`, `adb`, and
  `gradle` were unavailable.
- `pnpm run typecheck:libs` — passed.
- `pnpm --filter @workspace/bluebird run typecheck` — passed.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` — 15 passed,
  0 failed. All tokens and HTTP responses in this suite are mocks.
- `git diff --check` — passed.
- Confirmed `artifacts/bluebird/package.json` and `pnpm-lock.yaml` are unchanged.
- Confirmed the local/demo `AuthProvider` remains mounted and no Clerk provider
  or production token provider is connected to app screens.

- `pnpm run typecheck:libs` — passed.
- `pnpm --filter @workspace/bluebird run typecheck` — passed after the library
  typecheck.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` — 14 passed
  in the earlier authenticated-client review.
- `pnpm --filter @workspace/bluebird run test:production-membership-plans` — passed.
- `pnpm --filter @workspace/bluebird run test:startup-stability` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:network-reliability` — 11 passed.
- `EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production pnpm --filter @workspace/bluebird run test:production-queue-readiness` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:membership-plans` — 2 passed.
- `pnpm --filter @workspace/bluebird exec playwright test tests/flight-passenger-flow.spec.mjs --workers=1` — 11 passed.
- `git diff --check` — passed.

The compatibility probes used `pnpm add --lockfile-only` in disposable
worktrees. The active workspace's `artifacts/bluebird/package.json` and
`pnpm-lock.yaml` were not changed.

## Changed files

Existing authenticated-client foundations:

- `artifacts/bluebird/lib/productionAuthApi.ts`
- `artifacts/bluebird/tests/production-auth-api.spec.mjs`
- `artifacts/bluebird/tests/production-queue-readiness.spec.mjs`

Changed in this readiness review:

- `artifacts/bluebird/AUTHENTICATED-API-READINESS.md`
- `artifacts/bluebird/STAGE_2B_ACTIVATION_CHECKLIST.md`
- `artifacts/bluebird/tests/production-auth-api.spec.mjs`
- `.agents/memory/clerk-expo-sdk54-peers.md`
- `.agents/memory/MEMORY.md`
