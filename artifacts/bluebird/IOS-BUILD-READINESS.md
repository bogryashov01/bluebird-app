# Bluebird iOS build readiness

Audited 2026-10-17. This report describes the checked-in Mobile configuration
and the current Replit workspace only. It does not claim access to the Bluebird
owner's Expo, Apple Developer, App Store Connect, or EAS-hosted production
settings.

## Readiness summary

| Requirement | Status | Evidence |
| --- | --- | --- |
| iOS bundle identifier | **MISSING/BLOCKED** | The resolved Expo config has no `ios.bundleIdentifier`; no native iOS project overrides it. The owner must approve the exact unique reverse-DNS identifier controlled by the organization. It must not be inferred from `Bluebird` or `bluebird.co`. |
| EAS project linkage | **MISSING/BLOCKED** | `expo.extra.eas.projectId` is absent. EAS CLI configuration resolution stopped because the project is not configured. No project was created or linked. |
| Owner Expo/EAS account access | **MISSING/BLOCKED** | `expo whoami` and EAS CLI `whoami` found a signed-in Replit-managed private account. This is not evidence that the Bluebird owner or organization account is authorized for EAS builds. No owner account was used or verified. |
| Apple Developer access | **MISSING/BLOCKED — unverified** | No authorized Apple account or signing status check was available. No Apple team, signing credentials, or registered iPhone was verified. |
| iOS assets | **READY** | The configured app icon exists at 1024×1024 PNG, RGB with no alpha. The configured splash logo exists at 1462×326 PNG with alpha and is set to `contain` on `#0A1128`. |
| Production environment | **MISSING/BLOCKED — unverified remotely** | The EAS `production` profile selects the `production` environment, but the EAS-hosted variables could not be inspected without the owner account and project link. In the local workspace, the production API URL and production Clerk publishable key are absent, and the API environment selector is not set to production. |
| First iOS build | **MISSING/BLOCKED** | No build was started. The missing identifier, EAS project link, and owner-authorized EAS account block both simulator and device build requests from this workspace. |

## Configuration checked

- Expo SDK `57.0.30`, Expo CLI `57.0.31`, and React Native `0.86.3` are declared by the Mobile package.
- Resolved app identity: display name `Bluebird`, slug `bluebird`, version `1.0.0`, iOS build number `1`, scheme `bluebird`. `supportsTablet` is `false`.
- The global icon reference resolves to `./assets/images/icon.png`. The `expo-splash-screen` plugin references `./assets/images/bluebird-logo-white.png`; web splash settings use the same logo and background color.
- iOS declares the associated domain `applinks:bluebird.co`. No Apple App Site Association file exists under `artifacts/bluebird`; hosting and validity at the live domain were not checked. The app-side declaration does not prove Universal Links are operational.
- Configured permission behavior: image picker supplies photo-library and camera explanations; microphone permission is explicitly disabled; Calendar supplies its add-flight explanation; notifications are enabled through the Expo Notifications plugin. No separate `ios.infoPlist` values are configured.
- No root `ios/` native project or alternate `app.config.*` was found to override the checked-in `app.json`.
- `eas.json` retains the existing `development` internal development-client profile and the `production` profile (`environment: production`, `distribution: store`). The production submit profile remains empty for iOS.
- A local `development-simulator` profile now extends `development` and sets `ios.simulator: true`. This leaves the production build and submit profiles unchanged.

## Simulator versus installable iPhone build

Expo's [iOS Simulator build guide](https://docs.expo.dev/build-reference/simulators/)
confirms that a simulator build does not require an Apple Developer account.
It can only be installed on an iOS Simulator, not on an iPhone. The separate
profile is the documented way to keep simulator and device build settings
distinct. The [EAS configuration reference](https://docs.expo.dev/eas/json/)
documents the `extends`, `developmentClient`, `distribution`, and
`ios.simulator` properties used here.

The profile only establishes a local build path; it does not establish that the
app can be built now. A cloud build still needs the approved bundle identifier,
an EAS project, and an Expo account authorized for that project. This Replit
workspace runs Linux and cannot install the resulting app into Apple's
Simulator. No cloud or local build was run.

An installable iPhone development build is a different path: it requires
Apple Developer signing access, provisioning, and registering the test iPhone
for internal/ad hoc distribution. The existing `development` profile is
preserved for that device path.

## Required owner decisions and next actions

1. **Please provide the exact unique reverse-DNS iOS bundle identifier that
   Bluebird's organization approves and controls.** Set it as
   `expo.ios.bundleIdentifier` only after that decision. No value has been
   guessed or added.
2. Select or create the organization-owned EAS project, then authorize linking
   this app to that project. Do not use the Replit-managed private account as a
   substitute for the owner's project.
3. Sign in through the approved organization Expo account and verify that it
   can access the selected EAS project.
4. If a simulator build is desired, separately approve its EAS cloud-build use
   and any applicable usage charges. Once the identity, project, and account
   prerequisites are in place, the profile is
   `development-simulator`. No Apple Developer account is required for that
   simulator artifact.
5. Before producing an iPhone-installable development build, provide
   authorized Apple Developer access, configure signing, and register the
   intended test iPhone. Use the existing `development` profile, not the
   simulator profile.
6. Before a production store build, configure and verify the EAS `production`
   environment with the three public app-configuration values documented in
   `RELEASE-CONFIGURATION.md`: `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT` set to
   `production`, the canonical Production Main Bluebird API URL, and the
   matching Production Clerk publishable key. Also verify the owner-approved
   App Store Connect app and signing access. Supply `ascAppId` if non-interactive
   submission is required. No production values or submission settings were
   changed or checked remotely in this audit.

## Checks run

| Check | Result |
| --- | --- |
| `pnpm exec expo config --type public --json` | **PASS.** Expo resolved the public config, identity, asset references, and plugins. Bundle identifier and EAS project ID were absent. |
| `pnpm dlx eas-cli@latest config -p ios -e development-simulator --non-interactive --json` | **BLOCKED.** EAS CLI stopped because no EAS project is configured and cannot configure one in non-interactive mode. Its suggested project creation/linking was not performed. |
| Local `app.json` / `eas.json` parsing and focused readiness assertions | **PASS.** Both are valid JSON; icon dimensions/color mode and splash file were checked; simulator profile inheritance and flag were checked; production build/submit profile values remained unchanged; bundle identifier and EAS project ID remain absent. |
| `CI=1 pnpm exec expo install --check` | **PASS.** Dependencies are up to date. |
| `pnpm --filter @workspace/bluebird run typecheck` | **FAIL — pre-existing Mobile typecheck blocker.** TypeScript reports 192 errors across 36 files. Examples include missing generated API-client exports and incompatible shared model/query types. This audit did not change Mobile TypeScript or generated API code. |
| Read-only account status checks | **Owner access not verified.** The current CLI session is Replit-managed; the account identifier is intentionally omitted. No Apple account or EAS-hosted production environment check was made. |

The only functional build-configuration change is the separate local simulator
profile. No bundle identifier, EAS project, credentials, production values,
build, or submission were created or started.
