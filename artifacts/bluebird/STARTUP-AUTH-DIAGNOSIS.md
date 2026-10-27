# Bluebird Preview startup authentication diagnosis

## Current hosted Preview check — 2026-10-17

The actual Expo Preview origin checked was:

`https://cd8d8a20-320c-4224-accf-5c9dc7df2ff1-00-1ud53d7apx2xl-8uth0j1y.expo.worf.replit.dev`

All hosted route checks used a new isolated Chromium browser context at **402 × 874**. No cookies or storage were copied from the user's browser; the user's existing Preview session was not opened, cleared, or changed.

| Route | Initial capture | Settled hosted result |
| --- | --- | --- |
| `/` | The first screenshot was blank while the app was mounting. | Browser route changed from `/` to `/splash`; within the first 2-second observation “Get Started” was visible and remained visible for the following 15 seconds. |
| `/sign-in` | The sign-in screen appeared with “Preparing sign-in…” while Clerk initialized. | Within the first 2-second observation the phone input and “Send verification code” button were visible; the preparation state and configuration error were absent. The route remained `/sign-in` for at least 15 more seconds. No SMS was requested. |
| `/welcome` | A separate cold screenshot was also blank during initial app mounting. | Direct navigation in a fresh isolated context showed “Welcome to Bluebird” and “Continue with Phone” at the first 1-second observation; both remained visible through the 20-second observation. |

The isolated context began without the legacy `bluebird_token` or `bluebird_user` entries and without an imported Clerk session. The signed-out splash, Welcome, and sign-in form rendered; no signed-in route or member data appeared. Clerk storage was inspected only for a boolean presence signal, never for its contents.

## Runtime and configuration evidence

- The checked origin is the live Expo Preview host (`*.expo.worf.replit.dev`). The running Expo workflow logged Metro startup and successful Web bundles; this is not the checked-in `static-build` output. The browser loaded the current hosted bundle and the Clerk SDK.
- The browser console had **zero JavaScript errors and zero page errors**. Expo/Clerk resources produced no failed requests and no HTTP responses with status 400 or higher in the isolated root, sign-in, and Welcome checks. No Bluebird API request was needed to display these signed-out routes.
- The only relevant browser warnings were the expected React Native Web shadow-style notices, the web push-token-listener limitation, and Clerk's Development-key notice. The Clerk provider was mounted. The sign-in form only exposed its phone entry and send-code action after both Clerk auth and sign-in resources were ready; that ready state was reached during the first 2-second observation.
- Effective non-secret Development status: Clerk auth enabled; a present, syntactically valid Development publishable key; Development API environment selected; Development API base configured as a valid HTTPS `/api` URL; issuer configured as a valid HTTPS URL. No key, API URL, issuer value, token, phone number, or personal identifier is recorded here.
- Workflow output also contains a non-fatal attempt to start optional React Native DevTools failing because the host lacks `libglib-2.0.so.0`. Metro and the hosted web bundle still started successfully; the browser showed no corresponding app runtime error.

## Diagnosis

The persistent failure described in the task was **not reproduced** in a fresh, signed-out browser at the actual hosted origin. The initial blank root capture and the brief direct-sign-in preparation screen both resolved normally once Expo routing and Clerk initialization settled. This supports a cold-start/capture-timing explanation for the transient states observed in this check; it does not establish why a different, pre-existing browser context might remain stuck. That context was deliberately left untouched and therefore its session-specific state remains unverified.

There is no evidence in this run of a Mobile-owned route defect, missing Development Clerk configuration, failed Clerk bootstrap, failed Bluebird API call, or stale Preview bundle. No application-code change was justified. The `/sign-in` preparation view is the existing readiness gate, not a blank route after initialization. Local Playwright remains separate evidence: its config starts Expo on `127.0.0.1:20105`, defaults to Clerk-disabled auth, and supplies test API/issuer values; the startup tests also stub API requests. Those tests alone do not establish hosted Preview behavior.

## Verification and iOS impact

No app, auth, API, fixture, or queue code was changed. Bluebird TypeScript initially reported widespread stale generated API-client declarations. After rebuilding the local composite API-client declarations with `pnpm exec tsc -b lib/api-client-react`, `pnpm --filter @workspace/bluebird run typecheck` passed.

- `test:clerk-auth-ui`: 7 passed.
- `test:clerk-phone-auth`: 17 passed.
- `test:startup-stability`: 8 passed and 2 expected environment-specific skips in the default run; the Clerk-enabled Welcome and missing-key cases then each passed in their configured runs.
- Hosted recheck in the isolated signed-out context: `/` reached the signed-out splash, `/welcome` rendered Welcome, and direct `/sign-in` rendered the ready sign-in form. No authentication action was taken.

The Preview finding does **not** indicate an iOS startup defect or add an iOS build blocker. The existing, separate iOS readiness report still lists the missing approved bundle identifier, EAS project linkage, and owner-authorized Expo/Apple access as blockers; this task did not change or recheck those requirements. Queue safety gates and real-data behavior were not modified.

## Bounded Clerk startup recovery — 2026-10-27

Bluebird now distinguishes Clerk startup loading, ready, and failed states. A Production Clerk attempt that remains unready for 15 seconds shows a secure sign-in startup error with a Retry action instead of leaving the root route on its spinner. Retry remounts the Clerk provider for a fresh attempt. A provider that is missing or gated by the Production API/Clerk pairing remains blocked; it is not treated as a signed-out user and cannot reveal authenticated or legacy routes.

Startup diagnostics use an allowlisted event name, a Production boolean, an attempt counter, provider/readiness booleans, and broad error categories only. They do not log SDK error messages, keys, tokens, session data, phone numbers, or member identifiers.

The previously described TestFlight startup failure was not reproduced as part of this code change. The timeout and recovery behavior is implemented and covered by local tests, but an actual TestFlight/native installation was not available for verification. The underlying bootstrap cause therefore remains unknown; no EAS build or submission was performed.

Local verification: Bluebird TypeScript passed after rebuilding stale workspace declarations; the Clerk startup suite passed 8 tests; the Production auth-policy suite passed 5 tests; and the invalid-key browser check passed. The default startup browser run passed 8 tests with 2 expected skips. The Clerk-enabled local sign-in UI case could not reach the phone form because the test's placeholder `clerk.example.com` endpoint did not serve ClerkJS. That fixture limitation does not establish the cause of the separate TestFlight failure.

## Build 7 startup diagnosis — 2026-10-27

### Evidence sources and limits

- **Checked-in profile:** `artifacts/bluebird/eas.json` defines
  `production-auth-test` as a store-distributed profile using EAS
  `environment: "production"`. Its explicit overrides select the Production
  API, enable the restricted native-auth-test request policy, disable
  Development Clerk and full-app demo, and select Production flight and
  membership modes. It does not override the Production Clerk approval flag
  or the Production API URL, Clerk key, or issuer.
- **EAS record:** the connected Expo account's read-only build list and build
  details show a finished iOS `production-auth-test` build, app version
  `1.0.0`, iOS build version `7`, completed 2026-10-27. This verifies that the
  matching build artifact exists; it does not independently prove that this
  exact artifact was installed on the owner's iPhone during the reported
  attempt.
- **Owner-device report:** the task reports that the installed Build 7 reached
  the Clerk phone screen and displayed “Bluebird couldn’t initialize secure
  sign-in.” No Build 7 Apple Console export or sanitized event sequence was
  present in the workspace or task evidence. The prior device evidence in this
  file is for Build 6, not Build 7. The connected Expo tools provide EAS build
  records and EAS Observe data, not the owner's Apple Console log. EAS Observe
  returned no iOS app versions for the checked period.
- **Remote EAS environment:** the selected environment name is verified from
  the profile source, but the effective remote Production variable-presence
  status is **unverified**. The available Expo connection exposes no
  environment-variable listing, and EAS CLI is not installed in this
  workspace. Workspace secret names and any local preflight are not evidence
  of remote EAS values. No value was read, printed, or changed.

### What the source says the screen can mean

The Production configuration is evaluated from build-time environment values.
The profile's `EXPO_PUBLIC_ENABLE_CLERK_AUTH=false` disables Development Clerk;
it is not the Production approval gate. Production still requires the
separate approval flag, Production API selection, a valid live Clerk key, a
valid issuer, and matching key/issuer hosts before Clerk can be enabled. The
runtime also checks that the selected Main API configuration uses the same
Clerk key before mounting `ClerkProvider`. Production fails closed; it does
not switch to Development Clerk or legacy authentication.

When the phone screen shows the secure-sign-in startup error, the sign-in
action has not been enabled and no phone-code request is implied. The same
safe error presentation can result from distinct paths:

1. The provider is not mounted, including the runtime API/Clerk-pairing gate.
2. The provider mounted, but Clerk's auth snapshot did not become loaded
   within 15 seconds. In this case the source logs `timeout`, followed by
   `initialization_error` with category `timeout`.
3. The Clerk provider throws and the provider error boundary renders its
   startup-failure view. Its diagnostic records only a broad category:
   `clerk`, `network`, `timeout`, or `unknown`.

On a normal attempt, the source records `production_mode`,
`provider_mount` when mounted, `initialization_start`, and
`readiness_change` with the loaded boolean. A Retry increments the attempt
counter and remounts Clerk, restarting the bounded readiness attempt.
Sign-in/sign-up resource readiness is a separate condition: even after
`isLoaded` becomes true, the phone fields and request button remain disabled
until both resources are loaded. That disabled state alone does not show the
startup error. The startup logger does not currently record whether the native
Clerk configuration call returned, nor Clerk request stage/status details.

### Finding and next safe diagnostic

**Cause remains undetermined.** The screen confirms a fail-closed startup
condition, not whether the cause was a Production EAS configuration mismatch,
network failure, native/JavaScript Clerk bootstrap exception, or a missing
provider. The matching EAS profile/build record does not establish the
effective remote variable presence or the values embedded in Build 7, and no
Build 7 device event sequence is available to distinguish provider-missing,
timeout, or error-boundary paths. The generic device messages previously
reported for Build 6 cannot be attributed to Build 7 or treated as evidence of
a Keychain, TLS, or Clerk fault.

The smallest safe next step is to obtain, through the owner, a redacted Apple
Console excerpt from a fresh Build 7 launch through the displayed error and
one Retry. Preserve only event order/timestamps at coarse resolution and the
allowlisted diagnostic fields: event, Production boolean, attempt counter,
provider-mounted and loaded booleans, signed-in boolean, and broad error
category. Add only these sanitized observations if available: whether native
Clerk configuration returned; whether a Clerk request started; coarse
failure-stage and HTTP status or network category. Remove URLs, headers,
bodies, keys, tokens, phone numbers, identities, session identifiers, and raw
SDK/system error text. Separately, an authorized EAS environment view should
report only presence/status for the Production inputs, without exposing their
values. Until those observations exist, no configuration change, app-code
change, authentication fallback, or new build is justified.

## Earlier route-guard finding

The earlier diagnosis recorded a direct protected-tab startup race: tab screens could mount before legacy auth restoration finished. The tabs layout was subsequently changed to withhold those screens until restoration completes. That finding concerns protected-tab requests and is distinct from the current isolated hosted `/` and `/sign-in` checks above.

## Build 8 iPhone Clerk startup diagnosis — 2026-10-27

### Evidence and selected Production configuration

- The direct-device report supplied for this task says Build 8 reached the
  phone-auth screen, the Clerk auth snapshot bridge reported a snapshot, and
  `useAuth().isLoaded` remained false through the 15-second startup timeout.
  This is evidence of a rendered Clerk provider subtree with an unready auth
  snapshot, not evidence that a native Clerk event or token was received.
- A read-only Expo build-list/build-info check confirms a finished iOS
  `production-auth-test` artifact, app version `1.0.0`, build version `8`,
  created and completed on 2026-10-27, with Expo SDK metadata `57.0.0`. The
  record confirms the artifact exists; it cannot independently prove which
  binary was installed on the reported phone.
- The checked-in `production-auth-test` profile selects EAS `production`,
  `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production`, and the restricted native
  auth-test policy. It disables the Development Clerk flag and demo mode, but
  does not set the separate Production Clerk approval flag or override the
  Production API URL, publishable key, or issuer.
- Production Main API validation only accepts the `bluebirdjets.com` API host
  (the `/api` base path). Because the reported snapshot bridge is inside
  `ClerkProvider`, the source implies that the runtime passed the Production
  provider gates: Production was selected, the independent approval flag was
  true, a valid `pk_live_` key was present, its decoded host matched the
  configured issuer host, and the selected API/key pair matched. This is an
  inference from the observed mounted provider and checked-in gates, not a
  read of remote EAS values or proof of API-owner approval.
- The exact Production Clerk instance hostname is **not verifiable from the
  available workspace evidence**. The EAS build record exposes profile/build
  metadata, not the effective remote environment values. The connected Expo
  tools cannot list the remote Production variables. No publishable key,
  issuer value, URL value, token, or credential was read, printed, or saved.
  The exact remote Production approval and key/issuer values therefore remain
  owner-verifiable inputs.

### Startup path and evidence

1. `app/_layout.tsx` holds the splash until fonts load or font loading errors.
   It then enters `RoutedRoot`; the report that the phone-auth screen and
   snapshot bridge rendered rules out the font gate as the cause of this
   particular observed stall.
2. `clerkAuthConfig.ts` treats Production builds as Clerk-expected regardless
   of the Development auth flag. It requires the Production selector,
   independent Production approval, a valid live key, valid API URL, and
   issuer/key host parity. `mainBluebirdApiConfig.ts` pins the Production
   API host and `DormantClerkProvider` additionally requires the API
   configuration's key to equal the provider key. A failed gate blocks
   provider mounting; it does not fall back to Development or legacy auth.
3. `DormantClerkProvider` renders `ClerkProvider` with the selected
   publishable key and `@clerk/expo/token-cache`. Its snapshot bridge calls
   `useAuth()` and reports `snapshotReceived=true` from an effect even when
   `auth.isLoaded` is false. The Build 8 observation is therefore consistent
   with the bridge reporting an initial loading snapshot; it does not mean
   Clerk is ready.
4. In installed `@clerk/expo` 4.10.1, the provider creates the JS Clerk
   singleton with the supplied token cache and starts native bootstrap from
   an iOS layout effect. Bootstrap waits for the JS Clerk instance's loaded
   status, reads the cached client token with a one-second bound, calls the
   native `ClerkExpo.configure`, reconciles JS/native client state, then marks
   the native client ready. This native-ready flag is distinct from the app's
   `useAuth().isLoaded`.
5. The native iOS module exposes `configure` through an async Expo function.
   `ClerkNativeBridge.configure` configures or reconfigures ClerkKit with the
   publishable key, observes client/auth-flow changes, synchronizes token
   state, and waits in up to 30 × 100 ms intervals for the native client to
   load. A native configuration error rejects the bridge promise. The JS
   bootstrap retries a configuration error once after 250 ms; its pending-sync
   coordinator records failures and has a separate 10-second iOS tracking
   timeout. The coordinator timeout is not the app's 15-second readiness
   timeout, and source inspection does not show which, if either, was involved
   on Build 8.
6. The installed native token cache uses Expo SecureStore with iOS
   `AFTER_FIRST_UNLOCK` Keychain accessibility. A read exception triggers a
   delete attempt and returns null if that cleanup succeeds; save/delete
   failures can reject. The SDK also bounds one bootstrap cache read, but the
   underlying SecureStore/Keychain operations and actual Build 8 device state
   were not observed. The package's native Clerk keychain service defaults to
   the app bundle identifier unless a custom service is configured; this app
   does not set a custom service in its Clerk plugin options.
7. In `ClerkAuthPanel.tsx`, inputs and the code-request action stay disabled
   until `useAuth().isLoaded`, both legacy Clerk sign-in/sign-up resources,
   and the `setActive` function are ready. The Production 15-second timer in
   `AuthContext.tsx` fails closed and shows Retry; Retry increments the
   provider key to remount Clerk. The timer bounds the wait but does not
   diagnose or cancel a hung SDK/network/Keychain operation.

### SDK and native compatibility review

- The installed package is exactly `@clerk/expo` 4.10.1. Its declared peers
  include Expo `>=54 <58`, React `^18 || ^19`, and React Native `>=0.75`.
  Bluebird resolves Expo `57.0.31`, React `19.2.3`, React Native `0.86.3`,
  and `@types/react` `19.2.4`; these versions satisfy the declared Expo,
  React, and React Native ranges. This rules out an obvious declared-peer
  mismatch, not an undocumented runtime incompatibility.
- The Expo app config includes the Clerk config plugin with Apple Sign-In
  disabled. The installed plugin raises the iOS deployment target to 17.0;
  the Clerk podspec includes the native Expo module and pins Clerk iOS SDK
  1.6.1 through Swift Package Manager. The successful Build 8 build record
  and rendered JS provider do not prove the native module was present,
  configured, or able to use the device Keychain.
- The custom provider wrapper uses stable module-level contexts, the passed
  Production key/cache, and a keyed remount on Retry. No source evidence
  proves a wrapper lifecycle or key-selection defect. Native async failures
  are tracked by Clerk's sync coordinator. The wrapper's React error boundary
  does not itself observe arbitrary rejected native-effect promises; the app's
  bounded readiness timeout is the fallback for a still-unready auth snapshot.
  No sanitized Build 8 native configure result, failure stage, HTTP status, or
  device log was supplied.

### Phone-first account selection

The phone form starts in `sign-in` mode. `beginClerkPhoneAuth` calls
`startSignIn` first, and calls `startSignUp` only when the sign-in error has an
`errors[0].code` equal to Clerk's `form_identifier_not_found`. It does not
infer a missing account from HTTP 404/422 alone, a top-level code, or a
network/status failure. The focused phone-auth test verifies this behavior,
including rejection of other 422 responses. No phone request is enabled
before Clerk auth resources are ready.

### Findings, remaining causes, and action

- **Confirmed:** the observed failure is a readiness stall that crossed the
  app's 15-second bound; the provider subtree rendered and the auth snapshot
  was still not loaded. The app failed closed and did not enable phone
  requests.
- **Ruled out for this observation:** font loading never reaching the app,
  the provider being absent, an immediately rejected Production configuration
  gate, and choosing sign-up before the missing-account response.
- **Not established / still possible:** stalled JS Clerk initial resource
  loading; a blocked or failed iOS native module/configure call; network,
  DNS, TLS, or Clerk service response problems; SecureStore/Keychain read,
  write, or entitlement behavior; or an SDK/device-specific issue outside
  declared package peers. The snapshot and timeout alone cannot distinguish
  these causes. There is no evidence to claim any one of them caused Build 8.
- **Code change:** none. No reproducible Mobile-owned defect was demonstrated,
  so auth gates, provider wiring, timeout, and phone flow were left unchanged.
- **Exact owner checks before another build:** (1) inspect the remote EAS
  `production` environment in an authorized view and report only presence and
  status—never values—for the Production selector, approval flag, API base,
  live key, and issuer; confirm the selected API host is
  `bluebirdjets.com` and the key-host/issuer-host match; (2) on the existing
  Build 8 device, reproduce one cold launch and one Retry while preserving a
  redacted Apple Console timeline that records only startup event order,
  provider-mounted/snapshot/isLoaded booleans, native module/configure
  started/returned status, and broad error/network status categories; remove
  raw SDK/system messages, URLs, headers, bodies, keys, tokens, phone numbers,
  and identifiers; (3) confirm the built app's Clerk native module and iOS
  deployment target are present (17.0 or newer) and that a SecureStore read
  after the device has been unlocked does not throw. No phone sign-in or API
  request is needed for these checks.
- **Build decision:** another iOS build is not justified yet. First collect
  the owner-only configuration status and sanitized device timeline above.
  Build only if those observations isolate a Mobile-owned source defect and a
  focused regression fix is made; no build, upload, or deployment was
  performed for this diagnosis.

### Local verification

- `pnpm --filter @workspace/bluebird run test:clerk-startup`: **11 passed**.
- `pnpm --filter @workspace/bluebird run test:clerk-auth-ui`: **11 passed**.
- `pnpm --filter @workspace/bluebird run test:clerk-phone-auth`: **19 passed**.
- The first direct Bluebird typecheck reported stale generated API-client
  declarations. `pnpm run typecheck:libs` rebuilt the workspace composite
  libraries, after which `pnpm --filter @workspace/bluebird run typecheck`
  **passed**.
- `git diff --check`: **passed**. The only project-file change is this
  diagnosis report; no app or auth code changed.
