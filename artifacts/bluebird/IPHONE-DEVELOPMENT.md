# Bluebird iPhone development

## Runtime decision

Bluebird is locked to Expo SDK `57.0.30` and React Native `0.86.3`. The
SDK 57 documentation lists the installed `react-native-maps` `1.27.2` release
as available in Expo Go. Most other installed Expo modules used by Bluebird,
including image picker, location, SecureStore, and local notifications, are
also available there.

Expo Go is **not sufficient for the complete native app**: Bluebird uses
`expo-calendar` `57.0.5` in `lib/addToCalendar.ts`, and Expo's SDK 57
documentation explicitly says Calendar is unsupported in Expo Go and Snack.
The import is deferred until a calendar action, so Expo Go may load the rest of
the app, but that native action cannot be tested there. Remote push notifications
also have Expo Go limitations. Use a Bluebird **Development Build** to test the
full native API set. Expo Go remains an optional, partial UI/device preview.

## Why the Expo account warning appears

The “signed in to Expo Go but not Expo CLI” warning is an Expo Go 57
client/CLI account-session mismatch; it is not a Bluebird account, Clerk, or
production API error. Expo Go 57's phone-preview flow needs matching signed-in
Expo Go and CLI sessions. Replit provides a short-lived managed Expo CLI
session for the project. The `dev` script attempts that managed sign-in before
starting Metro, but login failure is deliberately non-fatal so the server can
still start. No interactive Expo login is needed to start the Replit workflow.

For Expo Go 57, use Replit's **Preview → Open in Expo Go** flow. If Replit
shows sign-in steps there, complete them in the UI and scan the QR again. If
those steps are absent, the managed sign-in flow is unavailable in that
workspace session; refresh the Replit workspace and restart the workflow, or
ask the workspace owner to resolve the session. Do not manually sign in to a
`replit-private-*` account or substitute another Expo account. If the
workflow's managed sign-in reports an unexpected response, the session may be
stale; refresh the Replit workspace and restart the workflow.

This Bluebird workflow targets a Development Build, not Expo Go. Opening the
Development Build's QR by scanning it does not require an Expo Go sign-in or
matching Expo account. The automatic, non-fatal Replit CLI session step remains
in place; no interactive CLI login is part of this workflow.

The old `--localhost` option made Expo advertise a loopback URL. An iPhone
cannot reach `localhost` on a Replit VM. The development server now uses LAN
host mode behind Replit's Expo proxy URL (`REPLIT_EXPO_DEV_DOMAIN`), which is
the phone-reachable route; use the URL/QR Replit shows, not a local IP or
`localhost`.

## Start and open Bluebird on iPhone

1. Open this project in the Replit Project Editor.
2. Start or restart the managed workflow **`artifacts/bluebird: expo`**. It
   runs the `dev` script with local flight-read mode and starts Expo for both
   browser preview and a Development Build. The existing `dev:stage1-web`
   script remains available for explicit production-read web checks; it is not
   the iPhone workflow.
3. Install the **Bluebird Development Build** on the iPhone first. In the
   Replit workflow console, find the Expo CLI's QR code and its
   `exp+bluebird://` URL. Scan the QR shown on your computer screen with the
   iPhone Camera and open it in Bluebird. If Bluebird opens to its launcher,
   choose the detected Replit development server. The URL uses Replit's Expo
   development domain; the iPhone and Replit VM do not need to share Wi-Fi.
4. Confirm Bluebird's Welcome screen appears on the iPhone and the Replit
   workflow log reports an iOS bundle. Make a harmless local UI edit and confirm
   it refreshes on the phone. This proves the JS bundle is loading; test each
   native permission/API separately on-device.

Expo Go can preview some UI and supported device APIs, but it is not the
configured runtime for this workflow and cannot validate the calendar action
or the full app-specific native configuration.

## Development Build prerequisites and current boundary

This repository now includes `expo-dev-client` and an internal
`development` profile in `eas.json`; those are preparation only. No build,
signing, device registration, or account login was performed.

The separate `development-simulator` profile extends `development` and sets
`ios.simulator: true`. Expo documents that simulator builds do not require an
Apple Developer account; they can only be installed on an iOS Simulator, not an
iPhone. The profile does not bypass the need for an approved bundle identifier,
an EAS project link, or an Expo account authorized to run the cloud build. This
Linux workspace cannot install or launch the resulting app in Apple's
Simulator. Do not run the build until its cloud-build use is separately
approved.

Before producing an iPhone build, the Bluebird owner must:

- Associate this project with the approved Expo/EAS project and use an
  authorized Expo account for cloud build access. Replit's managed Expo CLI
  session is not the owner's signing/build account.
- Choose and approve a stable, unique `ios.bundleIdentifier`. It is not
  currently set in `app.json`, so it must not be guessed.
- Provide Apple Developer Program signing/provisioning for internal device
  distribution and register each test iPhone with the provisioning profile.
- Distribute/install the signed development build on that registered iPhone.

This guide does not start a build or request credentials. Follow the
organization's approved iOS build and signing process only after those
prerequisites and separate approval are in place.

For an audit of the current configuration and prerequisite status, see
`IOS-BUILD-READINESS.md`.

## SDK alignment note

The SDK 57 patch recommendations for Expo, Auth Session, Crypto, Notifications,
Constants, Linking, Location, Router, and Splash Screen are aligned in the
package manifest and lockfile. Auth Session and Crypto were updated with
separate approval. This changes Expo package versions only; Clerk configuration,
application auth flows, and production auth settings were not changed.

## Safe scope

The Replit `dev` workflow sets Bluebird's flight-read mode to `local`. This
change does not alter the API server, Clerk behavior/configuration, production
settings, or deployment, and this runbook's verification does not make
production API requests.

In this Replit Linux workspace, the optional React Native DevTools helper logs
that `libglib-2.0.so.0` is missing. Metro still starts, prints the remote
Development Build QR/URL, and bundles the web preview. This did not block the
server, but the native debugger itself has not been verified here.

## Official references

- [Expo SDK 57 `react-native-maps`](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/)
- [Expo SDK 57 Calendar](https://docs.expo.dev/versions/v57.0.0/sdk/calendar/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Replit mobile app preview](https://docs.replit.com/features/artifact-types/building-mobile-apps)
