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
session for the project. The configured Expo Go command and the diagnostic
launcher attempt that managed sign-in before starting Metro, but login failure
is deliberately non-fatal so the server can still start. No interactive Expo
login is needed to start the Replit workflow.

For Expo Go 57, use Replit's **Preview → Open in Expo Go** flow. If Replit
shows sign-in steps there, complete them in the UI and scan the QR again. If
those steps are absent, the managed sign-in flow is unavailable in that
workspace session; refresh the Replit workspace and restart the workflow, or
ask the workspace owner to resolve the session. Do not manually sign in to a
`replit-private-*` account or substitute another Expo account. If the
workflow's managed sign-in reports an unexpected response, the session may be
stale; refresh the Replit workspace and restart the workflow.

The `artifacts/bluebird: expo` workflow defaults to Expo Go. Its
`BLUEBIRD_PRODUCTION_CLERK_DEBUG=true` opt-in switches the same workflow to a
Development Build. Opening that build's QR does not require an Expo Go sign-in
or matching Expo account. The automatic, non-fatal Replit CLI session step
remains in place; no interactive CLI login is part of this workflow.

The development server uses LAN host mode behind Replit's Expo proxy URL
(`REPLIT_EXPO_DEV_DOMAIN`), rather than advertising `localhost` or a VM-local
IP. The restarted workflow printed a proxy-backed Expo URL/QR, but direct
physical-device reachability was not tested. Use the URL/QR Replit shows; if
the iPhone cannot reach it, the diagnostic launcher has the tunnel fallback
described below.

## Start and open Bluebird on iPhone

1. Open this project in the Replit Project Editor.
2. For the Production Clerk diagnostic, set the non-secret
   `BLUEBIRD_PRODUCTION_CLERK_DEBUG=true` workflow variable and restart the
   managed workflow **`artifacts/bluebird: expo`**. Without this switch, the
   workflow stays in its existing Expo Go demo mode. The existing
   `dev:stage1-web` script remains available for explicit Production-read web
   checks; it is not the iPhone workflow.
3. Install the **Production Clerk debug Development Build** on the iPhone
   first. In the Replit workflow console, find the Expo CLI's QR code and its
   `exp+bluebird://` URL. Scan the QR shown on your computer screen with the
   iPhone Camera and open it in Bluebird. If Bluebird opens to its launcher,
   choose the detected Replit development server. The URL uses Replit's Expo
   development domain; the iPhone and Replit VM do not need to share Wi-Fi.
4. Confirm Bluebird's sign-in startup screen appears on the iPhone and the
   Replit workflow log reports an iOS bundle. Make a harmless local UI edit and
   confirm it refreshes on the phone. This proves the JS bundle is loading;
   test native startup separately as described below.

The default Expo Go Preview remains useful for supported UI/device checks, but
cannot validate the calendar action or full app-specific native configuration.

## Development Build prerequisites and current boundary

This repository includes `expo-dev-client`, an internal `development` profile,
and the separate `production-clerk-debug` profile in `eas.json`; these are
preparation only. No EAS build, signing change, device registration, or owner
account login was performed. The regular Replit Expo workflow's managed CLI
session is separate and does not grant EAS signing/build access.

The separate `development-simulator` profile extends `development` and sets
`ios.simulator: true`. Expo documents that simulator builds do not require an
Apple Developer account; they can only be installed on an iOS Simulator, not an
iPhone. The existing bundle identifier and EAS project association are
owner-confirmed and remain unchanged. This Linux workspace cannot install or
launch the resulting app in Apple's Simulator. Cloud builds still require
authorized Expo/EAS access and owner approval.

Before producing an iPhone build, the Bluebird owner must:

- Use an authorized Expo/EAS account for cloud build access. Replit's managed
  Expo CLI session is not the owner's signing/build account.
- Provide Apple Developer Program signing/provisioning for internal device
  distribution and register each test iPhone with the provisioning profile.
- Distribute/install the signed development build on that registered iPhone.

This guide does not start a build or request credentials. Follow the
organization's approved iOS build and signing process only after those
prerequisites and separate approval are in place.

For an audit of the current configuration and prerequisite status, see
`IOS-BUILD-READINESS.md`.

## Production Clerk iPhone diagnostic client

The isolated EAS profile `production-clerk-debug` is for investigating native
Clerk startup on an owner-registered iPhone. It creates an **internal
development client** using the existing Expo project, native dependencies, and
EAS `production` environment. It is not a TestFlight release profile.

### Start Metro from Replit

The regular `artifacts/bluebird: expo` workflow keeps its normal Development
behavior unless the non-secret Replit workflow variable
`BLUEBIRD_PRODUCTION_CLERK_DEBUG=true` is explicitly set. Set that switch only
for this diagnostic session, then restart the same Expo workflow. Its preflight
prints only presence/missing status for the Production API URL, Clerk
publishable key, API-verified issuer, and the separate Production auth approval
flag. It refuses to start if any are missing. It never prints their values.
Remove the switch and restart the workflow after the diagnostic to return to
normal Development mode.

The EAS `production` environment is **not automatically made available to
Replit's Metro process**. Metro must have its own matching values in the
workspace environment. The current Replit workflow had all four values and the
Production API selector present when this report was prepared; the legacy
`EXPO_PUBLIC_DOMAIN` value was absent. The debug launcher also explicitly
removes `EXPO_PUBLIC_DOMAIN` from the Metro child process and pins the native
auth-test API to the canonical Production host.

The Expo workflow is configured with Replit's Expo proxy URL and the Expo LAN
host mode. Use the `exp+bluebird://` QR/URL emitted in that workflow's console
on the iPhone. This is the preferred direct route; the task did not verify
reachability on a physical phone. If the proxy URL is not reachable from the
device, set `BLUEBIRD_EXPO_TUNNEL=true` for the same workflow and restart it;
the debug launcher then uses Expo's supported tunnel mode. Tunnel connectivity
is also unverified here.

### Install and inspect logs

1. Before a future internal build, use the authorized Expo/EAS account to
   confirm the existing iOS signing setup and register the test iPhone with
   EAS. Internal iOS installation requires signing/provisioning that includes
   that device.
2. From the repository root, the owner may run this command **only after**
   checking the remote EAS Production-variable presence and signing/device
   readiness:

   ```sh
   cd artifacts/bluebird && eas build --platform ios --profile production-clerk-debug
   ```

   This is a future command only; this task did not run it. On completion, open
   that build's EAS details page on the registered iPhone and use its install
   link/QR to install the internal development client.
3. Set the temporary Replit workflow switch above and restart
   `artifacts/bluebird: expo`. Scan the development-client QR from the workflow
   console, or open its `exp+bluebird://` URL on the iPhone. Confirm that the
   app connects to Metro and receives a JavaScript bundle.
4. Read forwarded JavaScript/Metro output in the Replit Expo workflow console.
   The development client can also open its React Native developer menu for
   React Native DevTools when available. The optional DevTools helper has not
   been verified in this Linux workspace because its host library is missing;
   use the workflow console as the primary log route.
5. For a device-level comparison, record only the existing allowlisted Clerk
   startup event, Production boolean, attempt number, provider/readiness
   booleans, and broad error category. Do not copy keys, tokens, phone numbers,
   account identifiers, URLs, or raw SDK/system errors into a report.

The profile forces Production API selection, turns off Development Clerk and
Full App Demo, and keeps the existing native auth-test restriction: only the
exact authenticated `GET /api/me` request is permitted. It does not override
the Production auth approval gate, API URL, Clerk key, or issuer. Invalid or
missing settings therefore block Clerk rather than falling back to Development
or legacy authentication. Replit web Preview origins and Clerk domain rules
are not changed.

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
