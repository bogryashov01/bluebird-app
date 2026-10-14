# Bluebird authenticated production API readiness

## Feature-flagged Clerk UI preparation (2026-10-13)

**Status: prepared and inactive by default; production authentication is not
ready.** Bluebird now has separate Clerk sign-in and sign-up routes and a
conditional Clerk provider mount. `EXPO_PUBLIC_ENABLE_CLERK_AUTH` must equal
the literal string `true`, and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` must match
the expected public-key format. A key alone, a missing flag, another flag
value, or a blank/invalid key leaves Clerk out of the active provider and
navigation trees. Direct access to disabled routes redirects to the existing
phone/demo welcome screen.

The Clerk management status was `not_configured` during this preparation, so
no Clerk instance or enabled authentication method could be confirmed. The
screens intentionally offer no email, password, phone, SMS, or OAuth actions
and do not call Clerk sign-in/sign-up APIs or create accounts. They show
loading, signed-out, signed-in, and sign-out-error states, and provide explicit
Clerk sign-out when a session exists. The existing phone onboarding and
`AuthContext` remain unchanged.

When enabled with a valid key, Clerk Expo's `tokenCache` (SecureStore-backed
on native) is used for the isolated UI session. This does not connect Clerk to
the demo JWT getter, `AuthContext`, generated API client, or production member
requests. The routes make no member/API calls; production auth remains
`unavailable`, and no authenticated production request was made.

### Owner confirmations and activation blockers

- Nick/product owner and API owner must identify the intended Clerk
  instance/environment and confirm its enabled sign-in methods. Only methods
  explicitly confirmed for that instance may be added.
- Confirm the matching environment-specific public key without posting it in
  source or chat. Never add a Clerk secret key to mobile.
- Confirm native app identifiers, redirect/return URLs, and SecureStore
  persistence/restoration using iOS and Android development builds.
- Confirm backend token verification, token/template/claims, identity mapping,
  `/api/me` semantics, and protected-route/expiry responses in an approved
  non-production environment before considering a production API connection.

Keep the flag disabled in release configuration until these confirmations and
native checks are complete. Enabling it only mounts the isolated provider and
shows the no-method status; it does not activate production member
authentication.

## Status

The dormant authenticated client now models the supplied member contract. A
Clerk token-provider adapter is prepared but not connected to `AuthContext` or
any production request. Production member reads and writes remain unavailable
until that provider is separately approved and native behavior plus server token
compatibility are established. In local flight-read mode, existing demo screens
continue using their existing local adapters. In production mode, profile,
membership, trips, queue actions, passenger/pet records, and trip manifests
remain unavailable instead of showing local demo member data as production
data.

## Dormant Clerk token bridge (2026-10-13)

**Status: adapter prepared; production API integration intentionally inactive.**
The root layout conditionally mounts the Clerk Expo provider only for the
explicitly enabled, syntactically valid public configuration described above.
The adapter is not connected to `AuthContext` or any API request. Production
authenticated requests remain unavailable.

### Verified mobile path and boundary

- `DormantClerkProvider` in `lib/dormantClerkIntegration.tsx` mounts only when
  the exact opt-in flag is set and the public key matches the expected
  `pk_test_…`/`pk_live_…` format. This is structural validation only; it does
  not establish the key value, instance, environment, or enabled methods. No
  Clerk secret key is used or embedded.
- The entry point passes Clerk Expo's `tokenCache` from
  `@clerk/expo/token-cache`. The installed SDK implementation uses
  `expo-secure-store` on native (including its configured
  `AFTER_FIRST_UNLOCK` accessibility option) and exports no token cache on
  web. This source evidence does not verify SecureStore persistence or restore
  on an iOS/Android device.
- `useDormantClerkProductionTokenProvider()` exposes the isolated bridge for a
  future consumer under that provider. Its adapter satisfies
  `VerifiedProductionTokenProvider`, checks current Clerk loaded/signed-in
  state, and calls Clerk `getToken()` for every explicit request. It returns
  `null` if Clerk is still loading, signed out, or returns no nonblank token.
  It retains no token and does not read `AuthContext`, `bluebird_token`,
  AsyncStorage, or any demo JWT. `getToken()` is called without a template
  argument; the required production token type/template and claims are not
  specified by the mobile code.
- `clearClerkSession()` delegates to Clerk `signOut()`. The isolated Clerk
  routes also offer Clerk-only sign-out when a session is present. Neither is
  wired to active `AuthContext.signOut()`, which continues to call the demo
  API logout, remove the demo token/user from AsyncStorage, clear query data,
  and navigate to the existing welcome route. Clerk sign-out, app/query cache
  clearing, and account-switch ordering must be integrated and tested
  separately before activation.
- `createAuthenticatedProductionApiClient()` asks its injected provider for a
  token for each explicit request, rejects missing/blank/whitespace tokens
  before fetch, sends `Authorization: Bearer <token>` with
  `credentials: 'omit'`, and validates the production base URL. It does not
  send cookies. A non-2xx HTTP 401 is normalized locally to
  `ProductionAuthHttpError` with code `session_expired`; there is no automatic
  refresh/retry or Clerk sign-out in that client. This mapping describes client
  code only, not the deployed server's response to an expired token.

### Supplied contract comparison

The supplied `0_BLUEBIRD_MOBILE_PRODUCTION_API_CONTRACT` is a source-derived
snapshot dated 2026-10-12 and explicitly says production runtime was not tested.
Its authentication section requires HTTPS
`Authorization: Bearer <Clerk session token>`, says Clerk validates expiration
and the SDK refreshes/gets tokens (no custom refresh endpoint), and describes
protected routes as returning 401 when identity is unresolved. It says
`GET /api/me` is the exception: it is optional-auth and returns HTTP 200
signed-out data with `isAuthenticated: false`, including for caught identity
lookup failures. The contract also explicitly leaves exact expired/malformed
token responses and production session TTL unknown and warns not to assume all
expired tokens return JSON 401.

The client models `/api/me` at its production `/api` base path, requires a
token before every call (including `getMe()`), and validates/returns the
`isAuthenticated` boolean without turning `false` into an error. Therefore:

- A **no-token** call cannot exercise the contract's anonymous `/api/me`
  response through this authenticated client: token acquisition fails before
  fetch. A separate unauthenticated request path would be needed if the app
  must use `/api/me` to discover signed-out state before Clerk sign-in.
- A **token-bearing HTTP 200** whose JSON says `isAuthenticated: false` is
  parsed as a signed-out result; callers must check that field before treating
  the response as an authenticated identity.
- For protected operations, the client treats an HTTP 401 as a local
  `session_expired` error, but it neither proves what the server returns nor
  retries with a refreshed Clerk token. The contract's exact deployed
  expired-token behavior remains unknown.

These distinctions are covered only by local mocks: the bridge test supplies a
mock Clerk session and injected fetcher, and the API test separately verifies
that a null token prevents its injected fetcher from running. A mocked HTTP 200
is not evidence of a production route, Clerk instance, or server acceptance.

### Backend and production unknowns

The supplied contract describes a Clerk-based backend source snapshot and
states that production runtime was not tested. The checked-in
`artifacts/api-server/src/middlewares/auth.ts` is a separate implementation:
it signs `{ userId }` tokens with `JWT_SECRET` or `SESSION_SECRET` (development
fallback only in development), then verifies that token with the same secret
and checks a local revoked-token table. Missing/malformed or unverifiable
tokens produce local 401 responses. This source does not show Clerk
verification, an issuer/audience check, or acceptance of Clerk session tokens.
It must not be used to claim that the supplied contract's server, or production,
accepts tokens issued by the intended Clerk instance. Its local 401 behavior
also does not resolve the contract's deployed-expiry unknown.

Before activation, Nick or the production API owner must answer and provide
evidence for all of the following:

1. Which exact Clerk instance/environment (development, staging, production)
   is intended, and which app/account/origins and native identifiers are
   registered for Bluebird?
2. Which environment-specific `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` belongs to
   that instance? Confirm its environment and matching issuer without posting
   the key in chat, source, or logs; this audit did not read any configured
   value.
3. Must the app send the default Clerk session token or a named JWT template?
   What exact issuer, audience, authorized-party/origin, subject/identity mapping,
   and other required claims does the API validate? Is an explicit Clerk
   `getToken({ template: ... })` call required?
4. Which deployed backend validates those tokens, and what change/configuration
   makes it accept only the intended issuer/claims while mapping the Clerk
   identity to a Bluebird account? Confirm that `/api/me` and the member
   routes in the contract are deployed on the same service as the mobile base
   URL; the checked-in API-server middleware is not proof.
5. What exact deployed responses/statuses should the app expect for missing,
   malformed, expired, revoked, pending, and otherwise unresolvable sessions?
   In particular, confirm `/api/me`'s anonymous 200/`isAuthenticated: false`,
   protected-route 401 behavior, response bodies, and whether a fresh Clerk
   token is accepted after an expiry response.

No answer to these production-specific questions is established by the
publishable-key variable name, installed SDK, contract snapshot, local server
source, or mocked tests.

### Remaining native and security gates

Still required are native iOS and Android development-build checks for
SecureStore writes/restoration, hosted sign-in return URLs, fresh token behavior,
sign-out, account switching, and app data/query-cache clearing. Expo web/iOS/
Android Metro exports only establish JavaScript bundling and are not runtime
verification. Do not log or persist bearer tokens outside Clerk's supported
secure cache; do not add a secret key to the app; keep production URL validation
and `credentials: 'omit'`; and do not silently route demo tokens into production
requests.

### Verification (2026-10-13)

- `pnpm --filter @workspace/bluebird run test:clerk-bridge` — 6 passed, 0
  failed.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` — 15
  passed, 0 failed.
- Both suites compile the local TypeScript modules and run Node tests with
  injected mock sessions/fetchers. They do not use production credentials or
  make network requests.
- The test coverage confirms missing/blank key handling, no token request while
  Clerk is unloaded or signed out, fresh token acquisition per request,
  delegated Clerk sign-out, no demo-token fallback, Bearer header, mocked
  `/api/me` false result, and no fetch when the provider has no token. It does
  not confirm production `/api/me` behavior or server acceptance.
- No production request, Clerk Dashboard inspection, credential read, SMS,
  payment, deployment, native iOS/Android build, simulator, or device test was
  performed. Native persistence, restore, redirects, and sign-in/sign-out still
  require device verification.

### Earlier bridge audit scope

- `artifacts/bluebird/AUTHENTICATED-API-READINESS.md`
- `artifacts/bluebird/STAGE_2B_ACTIVATION_CHECKLIST.md`

The 2026-10-13 bridge audit changed documentation only. At that point,
`app/_layout.tsx`, `app.json`,
`context/AuthContext.tsx`, the token bridge, API server, active screens, and
production-auth availability state were not changed.

### Before activation

1. Get the instance, environment-specific key configuration, token type/template,
   required claims, identity mapping, and deployment ownership confirmed in
   writing by Nick/the production API owner.
2. Have the production API owner confirm server-side issuer/signature/audience
   validation and exact `/api/me`, protected-route, and expired-session
   semantics using an approved non-production test environment. Keep any
   production runtime verification separate and explicitly authorized.
3. Complete native SecureStore/config-plugin/app-identifier and deep-link
   checks on supported iOS and Android development builds. Verify fresh token
   retrieval, restore, sign-out, account switching, and data/cache isolation.
4. Resolve the no-token `/api/me` contract mismatch and decide how the app
   distinguishes anonymous 200 from authenticated state before connecting any
   screens.
5. Review error handling, cache clearing, privacy/logging, and token handling;
   separately approve connecting the UI-only provider to the production API
   client and any `AuthContext`, navigation, or screen changes. Keep
   `PRODUCTION_AUTH_AVAILABILITY` unavailable until each gate is evidenced;
   activate only in a separate approved change.

## Clerk UI preparation verification (2026-10-13)

- `pnpm run typecheck:libs` — passed; followed by
  `pnpm --filter @workspace/bluebird run typecheck` — passed.
- `pnpm --filter @workspace/bluebird run test:clerk-auth-ui` — 5 passed,
  covering strict flag/key gating, provider/route access conditions, auth
  loading/errors/signed-out/signed-in state, Clerk sign-out success/failure,
  and no network request during sign-out.
- `pnpm --filter @workspace/bluebird run test:clerk-bridge` — 6 passed;
  `pnpm --filter @workspace/bluebird run test:production-auth-api` — 15
  passed. Both are mock-only and do not make production requests.
- Startup stability — 6 passed, including direct disabled-route redirects to
  the demo welcome screen with zero API calls. Network reliability — 11 passed;
  production queue readiness — 5; membership plans — 2; passenger flow — 11.
- Expo web, iOS, and Android JavaScript exports all passed with the Clerk flag
  explicitly false and the public key blank. These validate bundling only.
- No real Clerk credentials or methods were configured or used. No production
  API request was made. Native iOS/Android device sign-in, SecureStore
  persistence/restoration, deep links, and sign-out were not verified; these
  remain activation blockers.

## Expo SDK 57 screen migration (2026-10-12)

**Baseline: Expo SDK 57.0.27, React/React DOM 19.2.3, and React Native
0.86.3.** SDK 56 was not selected: its Hermes V1/Reanimated/Worklets memory
regression affects this app, and Expo identifies SDK 57.0.17 and later as
including the fix. React 19.2.3 is pinned in Bluebird only; the workspace React
catalog is unchanged.

The app migration also updates the SDK 57 NativeTabs child-component API,
removes TypeScript 6's deprecated `baseUrl`, replaces removed
`StyleSheet.absoluteFillObject` references, and moves native splash settings to
the `expo-splash-screen` config plugin while preserving the web splash. Expo 57
does not accept the old root-level `splash` field.

Validation on this baseline:

- `pnpm install --frozen-lockfile` — passed without peer-policy overrides.
- `pnpm run typecheck:libs` and the Bluebird app typecheck — passed.
- `EXPO_OFFLINE=1 CI=1 pnpm exec expo install --check` — passed against the
  installed SDK's bundled native-module map. Expo warns that this check is less
  reliable offline. The online map requested same-day package releases that the
  workspace's release-age policy blocks, so those newer packages were not
  installed and the package policy was not changed.
- `EXPO_OFFLINE=1 pnpm dlx expo-doctor@latest` — 21/21 checks passed.
- Expo web, iOS, and Android JavaScript exports — passed.
- Startup stability (5), network reliability (11), production queue readiness
  (5), membership plans (2), and flight passenger flow (11) browser tests —
  all passed.
- The managed browser preview starts and loads. Expo's optional React Native
  DevTools launcher reports that `libglib-2.0.so.0` is missing in this
  environment; Metro and the web preview continue to run.

These exports and browser tests do not replace a device run. The requested
Expo Go 57 check on an iOS simulator was not performed because it was
unavailable during this change; native runtime behavior remains unverified. No
Clerk provider, production authentication, or backend configuration was
changed; successful JavaScript exports do not establish native build or
authentication readiness.

## Clerk Expo SDK 57 dependency installation (2026-10-12)

**Decision: installed `@clerk/expo@4.10.1` with the three absent Expo
quickstart peers.** The complete resolved graph satisfies Bluebird's current
Expo/React/React Native peer requirements, and the isolated startup, TypeScript,
and three-platform Metro-import checks passed. This installs the SDK only:
`ClerkProvider` is not mounted, and production authentication remains disabled.

### Baseline and package policy

| Package | Bluebird declaration | Installed version |
| --- | --- | --- |
| Expo | `~57.0.27` | `57.0.27` |
| React / React DOM | `19.2.3` / `19.2.3` | `19.2.3` / `19.2.3` |
| React Native | `0.86.3` | `0.86.3` |
| Expo Router | `~57.0.25` | `57.0.25` |
| TypeScript | `~6.0.3` | `6.0.3` |
| React type packages | `@types/react ~19.2.4`; `@types/react-dom ~19.2.3` | `19.2.4`; `19.2.3` |

The stable `@clerk/expo@4.10.1` release was published on 2026-10-09
(`@clerk/react@6.17.8`, `@clerk/shared@4.40.0`, and
`@clerk/clerk-js@6.39.0` were published the same day), older than the
workspace's existing one-day minimum. The workspace still uses pnpm 10.26.1,
`minimumReleaseAge: 1440`, `.npmrc` `auto-install-peers=false`, and
`strict-peer-dependencies=false`. None of those settings changed. No peer
override, force/legacy-peer option, prerelease, or release-age bypass was used.

### Full Clerk peer graph and Expo module compatibility

| Resolved package | Direct peer requirements | Bluebird resolution |
| --- | --- | --- |
| `@clerk/expo@4.10.1` | Expo `>=54 <58`; React `^18 || ^19`; React Native `>=0.75` | Expo `57.0.27`; React `19.2.3`; RN `0.86.3` — satisfied |
| `@clerk/expo@4.10.1` optional runtime peers | React DOM `^18 || ^19`; Expo Auth Session `>=5`; Constants `>=12`; Crypto `>=12`; Secure Store `>=12.4.0`; Web Browser `>=12.5.0` | React DOM `19.2.3`; SDK 57 packages `57.0.14`, `57.0.21`, `57.0.3`, `57.0.4`, `57.0.3` respectively — all satisfied |
| `@clerk/react@6.17.8` | React and React DOM `^18 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0` | React / React DOM `19.2.3` / `19.2.3` — satisfied |
| `@clerk/shared@4.40.0` | The same React and React DOM ranges, both optional | React / React DOM `19.2.3` / `19.2.3` — satisfied |
| `@clerk/clerk-js@6.39.0` | No peer dependencies | No additional peer constraint |

The optional feature peers `@clerk/expo-passkeys >=0.0.6`,
`@clerk/expo-biometrics >=0.1.0`, `@clerk/expo-google-signin >=0.1.0`,
`expo-apple-authentication >=7.0.0`, and
`expo-local-authentication >=13.5.0` were reviewed and intentionally omitted;
Bluebird is not using those features. The full frozen install emitted no Clerk
peer conflict, and the isolated dependency tree showed the app, React DOM,
React Native, Expo, Router, Clerk React, and shared packages using the same
React 19.2.3 installation. Clerk declares no TypeScript peer; Bluebird's
TypeScript `6.0.3` check passed.

Clerk's [Expo quickstart](https://clerk.com/docs/expo/getting-started/quickstart)
uses `expo-secure-store`, `expo-auth-session`, `expo-crypto`, and
`expo-web-browser` for session storage and hosted browser sign-in. The SDK also
declares `expo-constants`; Bluebird already had compatible
`expo-web-browser@57.0.3` and `expo-constants@57.0.21`. Only the three absent
quickstart packages were added:

- `expo-auth-session@~57.0.14`
- `expo-crypto@~57.0.3`
- `expo-secure-store@~57.0.4`

Expo 57.0.27's installed `bundledNativeModules.json` map recommends Auth
Session `~57.0.14`, Crypto `~57.0.3`, Secure Store `~57.0.4`, Constants
`~57.0.21`, and Web Browser `~57.0.3`; all five installed versions match it.
The optional passkey, biometric, Google sign-in, Apple authentication, and
local-authentication peers were not installed because Bluebird is not using
those features. Expo SDK 57.0.17 updated React Native to 0.86.3 to resolve the
documented SDK 56 Hermes V1/Reanimated/Worklets memory regression; Bluebird is
on 57.0.27. See the
[Expo SDK 57 release notes](https://expo.dev/changelog/sdk-57).

The online `expo install --check` still reports six SDK package updates:
`expo-auth-session@57.0.15`, `expo-crypto@57.0.4`, `expo@57.0.28`,
`expo-location@57.0.21`, `expo-router@57.0.26`, and
`expo-splash-screen@57.0.10`. The directly relevant newer peer releases
(`expo-auth-session@57.0.15` and `expo-crypto@57.0.4`) and the Expo patch
`57.0.28` were published on 2026-10-12, only hours before validation, so the
1440-minute release-age policy correctly blocks those updates. The other three
are unrelated baseline patch updates and were not changed. The offline check
passes against SDK 57.0.27's bundled module map, but Expo explicitly warns that
offline dependency validation is less reliable; the online warning is recorded
as an unresolved validation limitation, not a passing online check.

### Native verification boundary and later Clerk approval

Isolated tests imported `ClerkProvider` from a temporary Expo Router probe and
exported web/iOS/Android bundles; the probe only referenced the symbol and did
not render a provider. No plugin configuration, app identifiers, hosted-auth
redirects, Clerk Native API setting, `AuthContext`,
`VerifiedProductionTokenProvider`, production-authenticated screen/request,
backend, secret, SMS, or payment code was changed. The temporary probe route
is removed.

Native builds and device checks could not be run here: Bluebird has no checked-in
`ios/` or `android/` directories, and `xcodebuild`, `adb`, and `gradle` are
unavailable. SecureStore behavior, config-plugin output, browser return URLs,
and native sign-in therefore still need iOS/Android development-build and
device verification. The dependency install is ready for a separately approved
ClerkProvider implementation review, but **production authentication is not
ready to activate** until native behavior and backend Clerk-token validation
are separately established.

Files changed for this installation:

- `artifacts/bluebird/package.json`
- `pnpm-lock.yaml`
- `artifacts/bluebird/AUTHENTICATED-API-READINESS.md`

### Verification results (2026-10-12)

- Disposable worktree: installed the same four-package manifest set under the
  existing pnpm policy; frozen-lockfile install, library/app typechecks, and
  web/iOS/Android Metro exports with a temporary `@clerk/expo` import all
  passed. The startup-stability suite passed 5/5.
- Main workspace: `pnpm install --frozen-lockfile`, `pnpm run typecheck:libs`,
  and `pnpm --filter @workspace/bluebird run typecheck` passed. All three
  Metro exports passed again with the temporary Clerk import present.
- The Expo offline dependency check passed against SDK 57.0.27's bundled map
  with Expo's warning that offline checking is less reliable. The online check
  did not pass: it requests the six newer versions listed above. The newer
  `expo-auth-session@57.0.15`, `expo-crypto@57.0.4`, `expo@57.0.28`,
  `expo-location@57.0.21`, `expo-router@57.0.26`, and
  `expo-splash-screen@57.0.10` were all published on 2026-10-12, under the
  one-day age limit at validation time. They were not installed.
- Every Bluebird package test script and every browser regression spec was
  exercised after installation. All nine non-browser script checks passed.
  The local browser group passed 36/38 tests; the production-mode group passed
  16/16. Startup stability specifically passed 5/5. The two local failures
  also reproduce on the unchanged baseline:
  - `test:family-mobile`, “primary holder can open Family management, invite a
    member, and reallocate passes”: after clicking “Create invitation”, the
    expected “Invitation created. Share the acceptance link with the invited
    member.” message was not found.
  - `test:networking-samples`, “development networking samples use the real
    API-backed connection flows”: Playwright failed with
    `route.continue: New URL must have same protocol as overridden URL`, then
    the test's tab click timed out.
  These are reported as existing regression failures, not passes; the baseline
  comparison found the same failures without Clerk installed.
- Restarted `artifacts/bluebird: expo`; Metro started and bundled the web app.
  The workflow also logs a non-fatal React Native DevTools launcher error
  because this environment lacks `libglib-2.0.so.0`. Preview screenshots
  remained blank during the short capture window; a direct browser check after
  8 seconds rendered Bluebird's “Private aviation, redefined. Get Started”
  entry screen with HTTP 200 and no page errors. Browser preview and native
  behavior are not substitutes for native builds or device verification.

## Historical Clerk Expo compatibility review (SDK 54 baseline; 2026-10-12)

**Historical outcome for the then-current Expo 54 / React 19.1.0 baseline:
blocked.** That assessment is superseded by the SDK 57 dependency installation
above; its version table and peer findings are retained as history.

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
transitive peer warnings were reviewed manually; neither SDK 54 candidate was
accepted. At that point no Clerk package was added and the manifest/lockfile
were unchanged; the later SDK 57 installation is documented above. No
dependency override, React/Expo upgrade, forced install, or package-policy
change was used.

### Historical isolated compatibility recheck (SDK 54 baseline; 2026-10-12)

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

The historical SDK 56 baseline-upgrade assessment below identified a React
patch compatible with those Clerk transitive peers, but not a safe runtime for
Bluebird's Reanimated/Worklets usage. The later SDK 57 screen migration alone
did not approve installing Clerk; the separate current SDK 57 dependency
review above records the subsequent full-graph validation and minimal install.
Do not pin Clerk internals, override peers, or change the workspace policy to
make an incompatible graph appear compatible.

At the time of this historical SDK 54 review, Clerk's
[Expo Quickstart](https://clerk.com/docs/quickstarts/expo) recommended
installing `expo-secure-store`, `expo-auth-session`, `expo-crypto`, and
`expo-web-browser`, and configuring the `@clerk/expo` and
`expo-secure-store` plugins. Bluebird then had only `expo-web-browser`; the SDK
57 installation above adds the three missing quickstart packages. Enabling
Clerk's Native API, configuring native app identifiers, and adding config
plugins remain later activation prerequisites, not changes made in this
dependency-only task.

## Historical Expo SDK baseline-upgrade assessment (Task 344, 2026-10-12)

**Historical outcome: SDK 56 was not approved, and Clerk was not activated.**
SDK 56 is the smallest stable Expo baseline whose official React version fits
the current stable Clerk transitive peer ranges. The isolated dependency graph
resolves without Clerk peer conflicts, and startup tests, regression suites,
and Metro exports work, but the Bluebird
TypeScript check fails on app API changes, native builds and OAuth redirects
were not verified, and Expo documents a Hermes v1 memory regression in SDK 56
for apps using Reanimated/Worklets. Expo recommends SDK 57 for apps affected by
that regression; SDK 57 was not tested in this assessment.
The follow-up migration and its SDK 57 validation are recorded in the section
above; this earlier assessment is retained as historical evidence.

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

**Historical approval boundary:** SDK 56 was not safe to approve as-is. At that
time, the eight type errors and Hermes memory regression were unresolved. The
current app baseline is SDK 57; iOS/Android device behavior, native builds, and
Clerk redirects remain unverified and out of scope for that assessment.

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

## Earlier dormant Clerk token bridge design

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

The implementation and current verification are documented in the
[2026-10-13 bridge section](#dormant-clerk-token-bridge-2026-10-13). This
earlier design statement is retained as history; production auth remains
inactive, and server-side acceptance of Clerk-issued tokens is still an
activation blocker.

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

## Earlier verification history (before the SDK 57 Clerk installation)

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
- Confirmed the local/demo `AuthProvider` remains mounted; the subsequently
  added Clerk provider and token adapter remain unconnected to app screens.

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

The earlier SDK 54/56 compatibility probes used disposable worktrees; at that
time, the active workspace's Bluebird manifest and lockfile were unchanged.
The separate SDK 57 Clerk installation and its current results are recorded
above and in the current verification section.

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

Changed for this SDK 57 Clerk dependency installation:

- `artifacts/bluebird/package.json`
- `pnpm-lock.yaml`
- `artifacts/bluebird/AUTHENTICATED-API-READINESS.md`
