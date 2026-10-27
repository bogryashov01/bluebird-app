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

## Earlier route-guard finding

The earlier diagnosis recorded a direct protected-tab startup race: tab screens could mount before legacy auth restoration finished. The tabs layout was subsequently changed to withhold those screens until restoration completes. That finding concerns protected-tab requests and is distinct from the current isolated hosted `/` and `/sign-in` checks above.
