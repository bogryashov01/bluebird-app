# Bluebird iOS development-build readiness

Audited 2026-10-18. This report covers checked-in Mobile code/configuration and
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
- Bluebird's phone-code and Clerk session logic, authenticated-token adapter,
  route/cache isolation, and API environment guards pass mocked/unit tests.
  The tests do not establish that a real Clerk instance or Main API accepts a
  token.
- Web/Playwright and code-level tests covering Discover presentation, flight
  reads, queue actions/guards, membership and preview gates, trips/profile
  navigation, personal information, notifications, payment-method empty
  states, airport selection, passenger prefill, and native photo-upload request
  construction pass. These are not iOS Simulator or device tests.
- The Expo icon and splash references exist. Icon: 1024×1024 RGB PNG without
  alpha. Splash logo: 1462×326 RGBA PNG; `contain` on `#0A1128`. All four
  relative asset references in the resolved app config exist.
- Focused source checks found the membership and queue preview routes gated by
  `__DEV__`; local flight reads require both `__DEV__` and the explicit local
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
  production environment. Development-only preview routes and local flight
  mode cannot be enabled in release by `__DEV__`-gated code. The `production`
  profile remains unchanged, but its remotely stored values and the resulting
  production app behavior were not inspected.

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

## Safe changes made

- Set the development EAS profile's environment explicitly to `development`;
  the simulator profile inherits it. Production build/submit profiles remain
  unchanged.
- Updated one stale source assertion in the Clerk session test to match the
  current membership loader structure.
- No runtime authentication, backend, Clerk, production, asset, or dependency
  changes were made.

## Checks and automated tests

| Check | Result |
| --- | --- |
| `pnpm exec expo config --type public --json` | **PASS.** Resolved app identity, iOS declarations, plugins, and asset references. No bundle identifier or EAS project ID is configured. |
| `CI=1 pnpm exec expo install --check` | **PASS.** Dependencies are aligned. |
| `pnpm dlx expo-doctor@latest` | **PASS.** 21/21 checks passed. |
| `pnpm exec tsc -b lib/api-client-react` then `pnpm run typecheck` in Bluebird | **PASS.** The first Mobile typecheck had 191 stale shared-client declaration errors; rebuilding the actual composite API-client project cleared them, and the rerun passed. |
| `test:clerk-session-isolation`, `test:clerk-bridge`, `test:clerk-phone-auth`, `test:clerk-auth-ui` | **PASS.** 9, 6, 17, and 7 tests respectively. |
| `test:startup-stability` | **PASS.** 8 passed and 2 conditionally skipped in the main run; the two Clerk-specific scenarios then passed in their dedicated runs. |
| `test:clerk-personal-info-screen`, `test:clerk-notifications-screen`, `test:membership-plans` | **PASS.** 4, 10, and 4 Playwright tests respectively; browser/mobile viewport emulation only. |
| `test:flight-map-platform`, `test:profile-photo-native` | **PASS.** iOS/web platform-resolution check and native-upload construction test. |
| Discover, production flight/airport, queue actions/readiness/guards, membership plans/previews, payment methods, airport selection, passenger prefill, and queue preview checks | **PASS.** All invoked checks passed; queue action and guard suites reported 4 and 3 tests, and payment methods reported 2. |
| EAS/Apple cloud build, iOS Simulator, physical iPhone, live Clerk SMS/API, and live AASA checks | **NOT RUN / NOT AVAILABLE.** Required owner access, identity, or native runtime was unavailable; no build or submission was started. |

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
   invitation links, sign-in/session restore, API access, map taps, queue/trip
   screens, membership, profile photo, notifications, and calendar on the
   selected iOS runtime.

No EAS build, production build, App Store Connect submission, iOS Simulator
launch, or physical-device test was performed.

## Files changed

- `artifacts/bluebird/eas.json`
- `artifacts/bluebird/tests/clerk-auth-session.spec.mjs`
- `artifacts/bluebird/IOS-BUILD-READINESS.md`
