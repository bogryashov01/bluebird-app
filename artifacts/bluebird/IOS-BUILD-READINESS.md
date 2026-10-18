# Bluebird iOS development-build readiness

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
  retrieval depends on EAS project linkage (there is no project ID yet); its
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

- **Bundle identifier:** `ios.bundleIdentifier` is absent. The Bluebird owner
  must provide the exact organization-approved unique reverse-DNS identifier;
  none was inferred from the product name or domain.
- **EAS project and account:** `expo.extra.eas.projectId` is absent. An
  organization-owned EAS project and an Expo account authorized for it are
  required before an owner-authorized cloud development build. This workspace
  did not link or create a project.
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
| `expo config --type public --json` | **PASS.** Bluebird `1.0.0`, scheme `bluebird`, build number `1`, and `applinks:bluebird.co` resolve. `ios.bundleIdentifier` and `extra.eas.projectId` are absent. Existing plugins and assets resolve. |
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

1. Approve and supply Bluebird's exact iOS bundle identifier.
2. Select/link the organization-owned EAS project and authorize the account
   that will run its builds; add the approved project linkage through the
   owner's process.
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
