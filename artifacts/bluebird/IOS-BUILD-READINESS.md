# Bluebird iOS development-build readiness

## Native Production auth TestFlight preparation (2026-10-26)

- **Dedicated profile: locally configured.** `production-auth-test` extends the
  store-distribution Production profile, selects the EAS `production`
  environment, and forces Production API selection, release flight reads, no
  demo, no local flight fixtures, no membership mocks, and no Development
  Clerk auth. Its separate request guard allows only authenticated
  `GET /api/me` at the canonical Production Main API. All other app API
  requests are denied before token lookup/network access, including writes and
  GET endpoints with possible server-side effects.
- **Production Clerk rollout gate: preserved / externally unverified.** The
  new profile does not set the approval flag or override the Production API
  URL, Clerk publishable key, or issuer. Clerk remains blocked unless the
  selected Production environment supplies the approved matching pair and
  enabled gate. The sanitized local preflight reports the Production selector,
  API/Clerk formats, issuer-host parity, and local approval gate as ready. This
  is workspace-only evidence; it does not inspect Expo/EAS's remote `production`
  environment or establish API-owner approval.
- **Native provider wiring: verified in source and focused tests.** The
  `@clerk/expo` provider receives its native token cache, the session adapter
  calls the current Clerk session's `getToken()` for each request, and the
  authenticated transport sends `Authorization: Bearer …`. No token or Clerk
  secret key is stored or printed. Native SecureStore persistence, restoration,
  and token acceptance by the Production API have not been exercised.
- **Allowed authenticated API operation:** only `GET /api/me`, used by the
  current Clerk member-resolution path. `GET /api/me/profile`, passenger-list
  GETs, phone-verification status GETs, and all other authenticated API calls
  are excluded. This conservatively avoids endpoint reads that may write or
  synchronize state. Queue/booking, membership, referral, payment, and profile
  mutations are blocked.
- **Backend confirmation still required:** the deployed Production Main API
  handler for `/api/me` is not included in this workspace. The allowlist is
  limited to the existing identity projection and matches the earlier
  owner-reported approved client configuration, but this task could not inspect
  the deployed handler for side effects. The API owner must reconfirm that this
  route remains genuinely read-only before any live authenticated check.
- **App identity:** version `1.0.0` and bundle ID `com.bluebirdjets.app` are
  unchanged. Build number remains `1`: no authorized EAS/App Store Connect
  build listing was available to verify the latest uploaded build. It was not
  incremented or guessed. Signing credentials and App Store Connect submission
  setup also remain unverified.
- **External blockers:** owner must verify the remote Production API/Clerk
  pairing and approval gate, inspect the latest uploaded iOS build number, and
  confirm reusable signing credentials and App Store Connect access. Source,
  mock, and local configuration checks do not prove device-level auth success.
- **Owner-run commands, not run here:** after those checks, from
  `artifacts/bluebird`, run `eas build --platform ios --profile
  production-auth-test`, then submit that exact successful build with
  `eas submit --platform ios --profile production --id <BUILD_ID>`. The submit
  profile has no configured `ascAppId` and may require authorized interactive
  setup.
- No remote setting, live sign-in, SMS, API request/mutation, EAS build,
  upload, TestFlight submission, deployment, or Git operation was performed.

### Focused checks for this preparation

| Check | Result |
| --- | --- |
| Shared-library and Bluebird TypeScript | **PASS.** `pnpm run typecheck:libs` and `pnpm --filter @workspace/bluebird run typecheck`. |
| Native Production auth-test boundary | **PASS.** 5/5 tests: exact Production `GET /api/me` allowlist, rejected methods/paths/hosts, denied requests before bearer-token lookup, EAS profile settings, and provider/token source wiring. |
| Clerk token bridge | **PASS.** 6/6 tests, including fresh token retrieval and Bearer transport. |
| Clerk auth configuration | **PASS.** 11/11 tests, including fail-closed Production approval and environment matching. |
| Production authenticated API | **PASS.** 23/23 tests, including side-effecting GET exclusion and mutation method contracts. |
| Resolved local Expo config | **PASS.** Public config resolved; version, bundle ID, and build number are unchanged. |
| Sanitized local Production preflight | **PASS, local workspace only.** Required inputs are present; API URL/key/issuer formats and issuer-host parity are valid; local approval flag is enabled; Production login reports ready. Owner verification, deployed token acceptance, and remote EAS values are not established. |
| Remote EAS/Apple checks, device sign-in, SecureStore restoration, live `/api/me`, EAS build, and TestFlight submission | **NOT RUN / NOT AVAILABLE.** No authorized remote account inspection or native runtime was available; no live request or release action was initiated. |

## EAS identity verification (2026-10-20, latest)

- **Resolved Expo owner:** `replit-private-cd8d8a20-320c-4224-accf-5c9dc7df2ff1`.
- **Resolved EAS project ID:** `7becc11e-ad08-40c7-ab29-317fe74c6ed7`.
- **Resolved slug / iOS bundle identifier:** `bluebird` /
  `com.bluebirdjets.app`.
- The values above are persisted in `app.json` and confirmed by
  `expo config --type public --json`. No local `.eas` linkage metadata or EAS
  CLI/account session was available, so remote account ownership and project
  linkage were not independently queried.
- The `production` EAS profile still selects the `production` environment and
  `store` distribution. The existing `@clerk/expo` plugin and production
  authentication gates are unchanged.
- **Apple signing reuse remains unverified.** A valid certificate/profile and
  its association with `com.bluebirdjets.app` could not be checked through an
  authorized, read-only account session. No credentials or profiles were
  created or modified.
- **Build retry status: not ready.** An owner with authorized Expo/EAS access
  must inspect existing iOS credentials read-only and confirm their validity
  and bundle-ID association before another store build attempt. Remote
  production environment values and production auth approval also remain
  unverified. No build or submission was run.
- **Exact changed files:** `artifacts/bluebird/app.json`,
  `artifacts/bluebird/RELEASE-CONFIGURATION.md`, and
  `artifacts/bluebird/IOS-BUILD-READINESS.md`.

## TestFlight production configuration audit (2026-10-20)

- **EAS profile:** `production` explicitly selects EAS `production` and store
  distribution; Development profiles select `development`. Remote EAS values
  were not accessible from this workspace. The production environment selector
  is verified in checked-in configuration; its actual API, Clerk, and legacy
  `EXPO_PUBLIC_DOMAIN` values are not verified.
- **Production inputs:** the connected Replit environment has no configured
  production values for the Main API selector, API base URL, or Clerk
  publishable key. Available Replit secret-presence metadata contains
  Development Clerk inputs only. This does not reveal or establish the remote
  Expo/EAS production environment. No production endpoint was contacted and no
  credential value was printed or recorded.
- **Current Development setup:** the connected Replit environment reports a
  Development selector and API base URL, plus Development Clerk key/issuer
  secret entries. Presence alone does not verify the current API/Clerk pairing
  or establish that the current Preview origin matches the saved preflight
  observation; credential contents were not retrieved.
- **Fail-closed behavior:** Main API config requires an explicit environment
  and the selected matching API/key pair. Production accepts only the
  code-approved canonical HTTPS `/api` endpoint and a live-format Clerk key;
  Development and Replit Preview endpoints, wrong key type, missing values,
  and legacy-variable-only configuration do not resolve. Production flight
  reads cannot select local fixtures outside `__DEV__`.
- **Production authentication:** current Clerk mounting and sign-in are
  Development-only. Production authentication is therefore not ready or
  enabled; supplying a live publishable key does not silently activate it.
  Keep this as a blocker until separately approved and implemented.
- **iOS identity:** name/slug are `Bluebird`/`bluebird`, bundle identifier is
  `com.bluebirdjets.app`, and EAS project ID is
  `7becc11e-ad08-40c7-ab29-317fe74c6ed7`; version/build are `1.0.0`/`1`.
  Icon and splash files resolve; photo-library, camera, and Calendar
  permission copy is configured, microphone permission is disabled, and iPad
  support is off. App Store Connect app ID, Apple team/signing credentials, and
  test-device registrations remain owner/Apple-controlled checks. No native
  iOS runtime was exercised.
- **Development `/api/me`:** the stored evidence records that the Fetch
  receiver fix uses `globalThis`, a credential-free Preview preflight
  succeeded, and a browser request with a test bearer received HTTP 200 with
  an anonymous projection. The preflight/request did not establish receipt or
  authentication for the user's signed-in Clerk request; Development API
  access logs and a current signed-in diagnostic result are unavailable here.
  No new request was sent, so the reported failure remains ambiguous: an
  earlier Fetch invocation is not proof of an HTTP response or root cause.
  There is no reproducible Mobile defect supporting a further transport
  change.
- **Owner next steps:** verify the remote EAS Production variables (including
  `EXPO_PUBLIC_DOMAIN`) and API/Clerk pairing; inspect existing signing
  credentials and confirm their validity and association with
  `com.bluebirdjets.app`; complete any explicitly approved Production Clerk
  work; then consider a later TestFlight build. See
  `RELEASE-CONFIGURATION.md`.

### Focused checks run for this audit

| Check | Result |
| --- | --- |
| Shared library build and Bluebird Mobile TypeScript | **PASS.** `pnpm run typecheck:libs` followed by `pnpm --filter @workspace/bluebird run typecheck`. |
| Main API configuration/environment tests | **PASS.** 11/11, including missing/legacy-only configuration rejection, Replit Preview host rejection, and Production key-type mismatch. |
| Clerk auth configuration tests | **PASS.** 7/7. Production Clerk remains intentionally disabled by the current Development-only auth gate. |
| `/api/me` diagnostic and transport tests | **PASS.** 12/12; Fetch invocation, HTTP status, sanitized ambiguous failures, and confirmation gates remain distinct. |
| Authenticated API and transport tests | **PASS.** 23/23, including the global Fetch receiver and explicit-request-only behavior. |
| Production flight/API environment tests | **PASS.** Production flight and airport read tests passed; local fixtures remain limited to Development. |
| Live signed-in Development diagnostic, remote EAS inspection, iOS Simulator/device, EAS build, TestFlight upload/submission | **NOT RUN.** No signed-in diagnostic result or owner/Apple account access was available; no request/build/upload/submission was initiated. |

## iOS Metro transformer error and archive-log audit (2026-10-20)

- **Resolved local versions:** Expo `57.0.30`, Expo CLI `57.0.31`,
  `@expo/metro-config` `57.0.13`, `@expo/metro` `56.0.2`, Metro
  `0.84.5`, `metro-transform-worker` `0.84.5`, and React Native `0.86.3`.
  The workspace Node runtime was `v24.13.0`; this does not establish the Node
  version used by EAS. These values describe this checkout's installed
  dependency graph, not necessarily the archived build's graph.
- **Metro setup:** `metro.config.js` returns Expo's `getDefaultConfig`, with
  no custom transformer. The resolved default `transformerPath` is Expo's
  `@expo/metro-config/build/transform-worker/transform-worker.js`; the Babel
  transformer is `@expo/metro-config/build/babel-transformer.js`. The Babel
  config uses `babel-preset-expo` with `unstable_transformImportMeta`.
- **Why the reported message can be secondary:** Metro `Bundler` catches an
  exception while initializing its dependency graph/transformer, writes
  `Failed to construct transformer:` and the original error object to stderr,
  then records `transformer_load_failed` without rejecting its ready promise.
  A later bundle request reaches `this._transformer.transformFile(...)` while
  `_transformer` is still unset, producing the secondary
  `Cannot read properties of undefined (reading 'transformFile')` error.
- **Forwarding:** the resolved Expo `react-native-xcode.sh` enables shell
  tracing (`set -x`) and invokes the Node CLI directly; it does not pipe or
  redirect the bundle command's stdout/stderr. Expo CLI's Xcode formatter
  intentionally emits only the error's first line as an Xcode diagnostic, then
  rethrows it. Its top-level command handler prints the error stack for ordinary
  errors. Metro's earlier `console.error` of the initialization error is not
  filtered by this script. Thus the source path does not show that Metro
  suppresses the first exception; the EAS build-details page is the known
  truncation point.
- **Exit-status caveat:** the Expo shell script uses `set -x`, not `set -e`.
  After the Node bundle command fails it still runs the Hermes or copy steps,
  then only checks for a missing final bundle. If an old bundle is already
  present at the checked path, later successful commands can mask the Node
  command's nonzero status. This can affect phase success/failure reporting,
  but it does not remove the earlier stderr lines from the raw log.
- **What could not be confirmed:** this checkout has no generated `ios/`
  project, `.xcresult`, archive, or EAS phase log. Therefore the exact
  `BUNDLE_COMMAND` and environment chosen by the owner's archived project, and
  whether that archive's UI preview clipped the earlier stderr, remain
  unverified. The checked-in `app.json`/`eas.json` do not define a custom
  transformer or replace the standard Expo Xcode script.
- **No diagnostic code was added:** source inspection shows the original
  initialization error and stack are emitted in the raw build stream. Adding
  a Metro hook would duplicate this behavior and alter bundler configuration
  without evidence that raw output is missing it. No dependency, transform
  behavior, build profile, auth setting, app identity, signing, backend, or
  website was changed, and no EAS build was started.
- **Expected lines in the next raw iOS phase log:** first, Metro's
  `Failed to construct transformer:` line followed by the original exception
  name/message and Node-formatted stack; later, the Xcode-formatted
  `error: Cannot read properties of undefined (reading 'transformFile')`
  line and the CLI-rethrown stack. The first exception's stack is the useful
  evidence; no new tagged diagnostic fields or version banner are added.
- **Retrieve the complete log:** in the completed EAS build details page,
  scroll to the bottom and choose the full Xcode log's view/download action;
  Expo documents that the normal iOS details page is abridged. If the preview
  is clipped, the build owner can download all artifacts and Xcode logs with
  `eas build:download --build-id <BUILD_ID> --all-artifacts`, then search the
  downloaded Xcode log for `Failed to construct transformer` and
  `transformFile`. The next owner-run archive is required to confirm whether
  those lines are present and whether the script's later commands masked the
  bundle command's exit status.

Audited 2026-10-18 after removal of Bluebird's temporary unauthenticated
Development Preview. This report covers checked-in Mobile code/configuration and
workspace-only automated checks. It does not claim access to the Bluebird
owner's Expo/EAS or Apple accounts, live Clerk/API services, or EAS-hosted
environment values.

## Verified working

- Expo resolves the public app configuration. Declared versions are Expo
  `57.0.30`, Expo CLI `57.0.31`, React `19.2.3`, and React Native `0.86.3`.
- `CI=1 pnpm exec expo install --check` passes; `pnpm dlx expo-doctor@latest`
  reports **21/21 checks passed**.
- The iOS FlightMap bundle resolves the native `react-native-maps` component;
  the platform-resolution check also confirms the web implementation remains
  separate.
- Bluebird's normal phone-code/Clerk session flow, authenticated-token adapter,
  route/cache isolation, and API environment guards pass mocked/unit tests.
  The tests do not establish that a real Clerk instance or Main API accepts a
  token.
- Automated web and code-level tests cover normal signed-out routing, protected
  routes, Discover and Flight Details, queue actions, Membership, Trips/Profile
  navigation, personal information, notifications, and Payment Methods. The
  signed-out Clerk route protection and Welcome-to-Clerk sign-in route pass.
  These are not iOS Simulator or device tests.
- The Expo icon and splash references exist. Icon: 1024×1024 RGB PNG without
  alpha. Splash logo: 1462×326 RGBA PNG; `contain` on `#0A1128`. All four
  relative asset references in the resolved app config exist.
- The unauthenticated Development Preview route tree, navigation entries,
  preview-only auth context, state fixtures, and runtime helpers are removed.
  A focused source test verifies the old route files are absent, named feature
  screens remain, and app/auth/navigation sources have no preview branches.
  Local flight reads still require both `__DEV__` and the explicit local
  selector. Test-key-shaped strings and example email/host fixtures are
  confined to test/test-runner files. No private-key block or actual secret
  value was found in the checked Mobile runtime source. No credential values
  are included in this report.

## Code/configuration ready but untested on iOS

- Resolved identity is display name `Bluebird`, slug `bluebird`, version
  `1.0.0`, build number `1`, and URL scheme `bluebird`; iPad support is off.
  No alternate Expo config or checked-in native `ios/` project overrides
  `app.json`.
- iOS declares `applinks:bluebird.co`. Android declares `/join/` intent
  handling. The domain's Apple App Site Association hosting/content and actual
  Universal Link launch behavior were not checked.
- Permission text is configured for photo library, camera, and Calendar;
  microphone permission is disabled. Notifications use the Expo Notifications
  plugin and request permission after sign-in. No runtime location-permission
  request was found. Native permission prompts/actions were not exercised.
- Clerk uses `@clerk/expo`'s SecureStore-backed token cache; the adapter fetches
  a fresh token from the current session for each request. Sign-out delegates
  to Clerk and clears member query data. Phone sign-in/verification does not
  use a browser OAuth return flow. Discover has an app-resume listener. These
  behaviors were reviewed/tested with code or mocks, not by resuming a native
  app or receiving real SMS.
- `expo-calendar` is installed and configured for the calendar action; the
  action requires a development build and was not invoked on iOS. Map rendering,
  camera/library access, calendar access, push-token registration, and actual
  native session restoration remain device-runtime checks. Push-token
  retrieval depends on EAS project access; the ID is now present in local
  configuration, but remote account access has not been checked. Its
  optional error handling keeps sign-in available, but push registration is
  not verified.
- The EAS `development` profile is an internal development-client profile and
  now explicitly selects the `development` environment. The
  `development-simulator` profile extends it and sets `ios.simulator: true`.
  The `production` build and submit profiles are byte-for-byte unchanged from
  the checked-in baseline.
- Production/demo safety was checked in source, not against the remote EAS
  production environment. Development Preview routes no longer exist, and
  local flight mode cannot be enabled in release by `__DEV__`-gated code. The
  `production` profile remains unchanged, but its remotely stored values and the
  resulting production app behavior were not inspected.

## Blocked by owner / Apple access

- **Identity:** the owner-confirmed `com.bluebirdjets.app` bundle identifier
  and `7becc11e-ad08-40c7-ab29-317fe74c6ed7` EAS project ID are now persisted
  locally. The Expo account session and project authorization were not
  independently checked, and no project was created or linked here.
- **Development environment values:** Remote EAS values could not be inspected.
  The owner must configure and verify the `development` environment:
  `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=development`,
  `EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL`,
  `EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_ENABLE_CLERK_AUTH=true`, and
  `EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER`. The API URL, Clerk
  Development key, and verified issuer must be the owner's matching pair; no
  values were accessed or added here.
- **iPhone-installable build:** Apple Developer signing/provisioning access and
  registration of each intended test iPhone are required. No Apple team,
  signing credential, or device registration was verified. A simulator build
  does not require Apple Developer signing, but still requires the approved
  EAS project/account and owner approval to use cloud-build resources.
- The `bluebird.co` association file must be confirmed with the domain owner
  before Universal Links can be considered operational.

## Changes in this cleanup

- Removed the unauthenticated preview screens, route registrations,
  user-facing preview links, preview-only AuthContext branch, runtime helpers,
  and preview-only tests. Normal Clerk auth and real feature screens remain.
- Added checks for preview route/entry removal and protection of the old paths.
  Queue guard tests now cover queue behavior without preview state utilities.
- No Expo/EAS settings, dependencies, SMS configuration, session persistence,
  logout behavior, API access policy, backend, database, or Clerk configuration
  were changed. Existing development EAS and simulator profiles, and production
  build/submit profiles remain unchanged.

## Checks and automated tests

| Check | Result |
| --- | --- |
| `expo config --type public --json` (preceding identity audit) | **PASS at that time.** Bluebird `1.0.0`, scheme `bluebird`, build number `1`, and `applinks:bluebird.co` resolved. The bundle identifier and EAS project ID were absent then; they are now present and verified in the latest audit above. Existing plugins and assets resolved. |
| `CI=1 expo install --check` | **PASS.** Dependencies are aligned. |
| `expo-doctor@latest` | **PASS.** 21/21 checks passed. |
| Expo Web `/welcome` smoke check | **PASS.** Signed-out Welcome and the ordinary phone sign-in entry render; the deleted preview button is absent. |
| Shared library build and Bluebird Mobile TypeScript | **PASS.** `pnpm run typecheck:libs` followed by `pnpm --filter @workspace/bluebird run typecheck` completes successfully. |
| Preview-removal source guard and old-path auth checks | **PASS.** Deleted routes/helpers are absent, named feature screens remain, and old preview URLs route signed-out Clerk users to sign-in. |
| `test:startup-stability` | **PASS.** 8 passed and 2 conditionally skipped in the default run; Clerk-enabled and missing-key scenarios passed separately (1 each). |
| Clerk auth/session/phone/profile unit checks | **PASS.** Session isolation 9, token bridge 6, phone auth 17, auth configuration 7, member resolution 14, Bluebird profile 45. |
| Personal Information, Notifications, Membership, Home Airport, and Payment Methods | **PASS.** Personal Information 4, Notifications 10, Membership MVP 7, public plan surfaces 4, Home Airport selection checks, Payment Methods 2. |
| Queue actions/guards, membership plan parsing, and flight-map platform resolution | **PASS.** Queue actions 4, queue guards 2, production membership plan tests passed, iOS/web platform bundle check passed. |
| `test:network-reliability` | **PASS.** 24/24 passed. The Flight Details viewport check now verifies scroll reachability, the airport-directions action, and no horizontal overflow at 375×812 and 320×568. |
| `test:production-queue-readiness` | **PASS (Development fixture only).** 6/6 passed. Its Airport Search check verifies the configured Development API fixture, not a production-configured app session. See Task 603 triage below. |
| EAS/Apple cloud build, iOS Simulator, physical iPhone, live Clerk SMS/API, and live AASA checks | **NOT RUN / NOT AVAILABLE.** Owner access, identifiers, or native runtime were unavailable. No build or submission was started. |

## Task 603: triage of the two deferred checks

### Flight Details at compact viewport sizes

- **Root cause:** the old browser assertion compared the airport-arrival row's
  document-coordinate bottom (`761px`) with a fixed `<702px` cutoff at 375×812.
  Flight Details is a vertically scrolling screen; the row being below that
  arbitrary line did not establish clipping, loss of the action, or horizontal
  overflow. The screen already has scroll content padding for its fixed bottom
  action area.
- **Disposition:** no Flight Details UI change was warranted. The assertion now
  scrolls to the arrival-directions control, checks that it is in the viewport
  and within the horizontal bounds, opens the directions choices, and checks
  document width at 375×812 and 320×568.
- **Result:** the selected-flight navigation and compact viewport checks pass.
  This verifies the web-rendered Mobile flow, not native iOS safe-area behavior
  on a Simulator or device.

### Airport Search and environment selection

- **Root cause:** Airport Search uses the selected Main Bluebird API
  configuration. The Playwright Expo server sets
  `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=development` and routes
  `https://main-api-development.example.test/api` to a test fixture. Setting
  `EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production` changes flight reads; it
  does not retarget Airport Search. The old test listened only for a response
  from `https://bluebirdjets.com`, so it missed the Development fixture response
  even though the debounced query ran and the UI rendered the fixture's DAL
  result.
- **Disposition:** no Mobile, auth, or backend defect was confirmed. The test
  now observes the selected fixture API's airport-search request and response,
  checks the `q` value, successful array response, and absence of an
  Authorization header. It explicitly records that this is a Development
  fixture check, not production-service verification.
- **Live service observation:** a direct, read-only request from the workspace
  to `https://bluebirdjets.com/api/airports/search?q=Dallas` returned HTTP 200
  with a JSON array containing 10 results. This does not verify the app's
  production configuration, browser CORS behavior, or an iOS runtime.
- **Remaining limitation:** a production-configured Mobile/browser Airport
  Search flow remains unverified. The workspace's controlled browser setup is
  Development-configured; production app environment values and owner access
  were not inspected. Treat this as an access/configuration verification gap,
  not a product failure.

### Focused regression checks run for Task 603

| Check | Result |
| --- | --- |
| Bluebird Mobile TypeScript | **PASS.** `pnpm run typecheck:libs` then `pnpm --filter @workspace/bluebird run typecheck`. |
| `test:network-reliability` + `test:production-queue-readiness` | **PASS.** 30/30 browser tests passed, including Flight Details navigation, compact layouts, Queue read-only behavior, and configured public Airport Search. |
| `test:startup-stability` | **PASS.** Default Clerk-disabled run: 8 passed, 2 conditionally skipped. Clerk-enabled Welcome: 1 passed. Requested Clerk with missing key: 1 passed. |
| Home Airport and Profile navigation screens | **PASS.** `test:clerk-notifications-screen` 10 passed; `test:clerk-personal-info-screen` 4 passed; `test:payment-methods-screen` 2 passed. |
| Airport selection and Clerk profile logic | **PASS.** `test:airport-selection` passed; `test:clerk-bluebird-profile` 45 passed. |
| Queue, Membership, and Clerk routing regressions | **PASS.** `test:membership-mvp` 7 passed; production queue actions 4 passed; queue gate 2 passed; Clerk session isolation 9 passed; Clerk auth UI 7 passed. |
| Production airport-search reader | **PASS.** `test:production-airport-search` passed request, response-shape, auth-header, and failure-state checks. |

## Owner next steps

1. In the authorized Expo/EAS account, verify access to the existing project
   and inspect signing credentials read-only for validity and association with
   `com.bluebirdjets.app`.
2. Continue to use the existing project and confirmed identifiers; this
   workspace did not create or relink an Expo project.
3. Populate and verify the EAS `development` environment variables listed
   above, including a matching Development API/Clerk issuer pair.
4. For a simulator-only first build, use `development-simulator` after the
   owner approves the cloud build. For an iPhone-installable development build,
   use `development` after Apple signing/provisioning access and test-device
   registration are ready.
5. Confirm the `bluebird.co` Apple App Site Association file and then test
   invitation links, SMS sign-in/session restore, API access, map taps, queue/trip
   screens, membership, profile photo, notifications, and calendar on the
   selected iOS runtime.

No EAS build, production build, App Store Connect submission, iOS Simulator
launch, or physical-device test was performed.

## Files changed

- `artifacts/bluebird/DEVELOPMENT-API-CONNECTION.md`
- `artifacts/bluebird/app/_layout.tsx`
- `artifacts/bluebird/context/AuthContext.tsx`
- Preview-only screen/helper/test removals under `artifacts/bluebird`
- `artifacts/bluebird/tests/startup-stability.spec.mjs`
- `artifacts/bluebird/tests/development-preview-removal.spec.mjs`
- `artifacts/bluebird/tests/network-reliability.spec.mjs`
- `artifacts/bluebird/tests/production-queue-readiness.spec.mjs`
- `artifacts/bluebird/package.json`
- `artifacts/bluebird/IOS-BUILD-READINESS.md`
