# Bluebird iOS release configuration

This note records Bluebird's owner-confirmed Expo/EAS identity and the remaining requirements for an iOS production build and App Store submission. No app identity, EAS project, credentials, or production environment values were created here.

## EAS identity verification (2026-10-20)

- **Effective Expo owner:** `replit-private-cd8d8a20-320c-4224-accf-5c9dc7df2ff1`.
- **Effective EAS project ID:** `7becc11e-ad08-40c7-ab29-317fe74c6ed7`.
- **Effective slug / iOS bundle identifier:** `bluebird` / `com.bluebirdjets.app`.
- These exact owner-confirmed values are persisted in `app.json` and were
  verified in Expo's locally resolved public config. This is local config
  evidence; no Expo account session, EAS CLI, or local `.eas` linkage metadata
  was available for a remote account check.
- The EAS `production` build profile remains configured with
  `environment: "production"` and `distribution: "store"`. The `@clerk/expo`
  plugin remains configured with `appleSignIn: false`; production
  authentication gates and runtime code were not changed.
- **Apple signing reuse: unverified.** This workspace had no authorized,
  read-only EAS credential inspection available. Certificate validity,
  provisioning-profile status, and association with
  `com.bluebirdjets.app` therefore cannot be established. No signing
  credentials or provisioning profiles were created or changed.
- **Another iOS EAS store build attempt is not ready.** Before retrying, the
  owner must inspect the existing iOS credentials in the authorized Expo/EAS
  account and confirm that a valid, reusable profile/certificate is associated
  with `com.bluebirdjets.app`. The production EAS environment values and the
  separate production-auth approval gate also remain outside this workspace's
  verification.
- **Exact changed files:** `artifacts/bluebird/app.json`,
  `artifacts/bluebird/RELEASE-CONFIGURATION.md`, and
  `artifacts/bluebird/IOS-BUILD-READINESS.md`.
- No EAS build or App Store submission was started.

## Current production configuration audit (2026-10-20)

- The checked-in EAS `production` profile explicitly selects the named
  `production` environment and store distribution. It does not extend either
  Development profile. This verifies the profile selection only, not the
  values stored in Expo/EAS.
- This workspace has no production values for the three Main API variables
  below. The connected Replit environment does not expose the owner's remote
  EAS production environment, so its values, visibility, and access controls
  remain unverified. No production request was made.
- Mobile Main API selection is explicit: only the selected environment's
  matching API URL and Clerk key are consumed. The production API URL is
  restricted to the existing canonical HTTPS `/api` endpoint; Development,
  Preview, legacy API, and wrong Clerk-key-type values fail configuration
  validation rather than becoming Main API fallbacks.
- Production Clerk sign-in is not active by default. The Mobile provider now
  has a separate Production gate, but it stays blocked until the API and Clerk
  owners approve the matching pair and the owner-configured production
  environment explicitly enables it. A `pk_live_` value alone is not approval.
  Do not turn on the Development flag or reuse its key.
- The legacy generated API client can also receive `EXPO_PUBLIC_DOMAIN`.
  Because the remote EAS values could not be inspected, the owner must verify
  that the Production EAS environment does not point this legacy base URL at a
  Development or Replit Preview service. This is an external configuration
  verification blocker, not evidence that such a value is currently set.

## Production EAS environment

Configure the named EAS `production` environment with these public app-configuration variables:

- `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT` must select `production`.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL` must identify the Production Main Bluebird API. The mobile configuration accepts only its configured canonical HTTPS `/api` endpoint.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY` must be the Production Clerk publishable key (`pk_live_…`) for the Clerk instance paired with that API.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER` must be the API-owner-verified Production Clerk issuer and match the instance encoded in the Production publishable key.
- `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH=true` is the explicit rollout approval gate. Set it only after both API and Clerk owners confirm the Production pairing, token acceptance, and identity mapping; otherwise leave it unset.

The API URL, environment selector, and Clerk publishable key are embedded in the mobile app configuration; they are not server secrets. The publishable key is public by design but must belong to the correct Production Clerk instance. Do not put private keys, API tokens, or other server credentials in `EXPO_PUBLIC_` variables or in this repository. Keep any genuine secrets in an approved secret store.

## Owner inputs required

- Confirm that the existing Apple signing credentials are valid and associated with `com.bluebirdjets.app` through an authorized, read-only EAS credential inspection. Do not create or change credentials as part of this verification.
- Supply the App Store Connect app's numeric Apple ID (`ascAppId`) if submission should be non-interactive. No App Store Connect app ID is available in this project.
- Provide authorized Apple Developer / App Store Connect access and configure signing/submission credentials through EAS when the owner is ready. Do not commit Apple credentials or add guessed team/account values here.

The `submit.production` profile intentionally leaves `ios` values empty until those owner inputs are available; EAS Submit can prompt for missing values interactively.

## Before an owner-authorized TestFlight build

1. In the organization-owned Expo account, inspect the `production` EAS
   environment and verify the API URL, environment selector, and live Clerk
   key belong to the approved Production API/Clerk pair. Also inspect
   `EXPO_PUBLIC_DOMAIN`; remove it if unused or verify its approved Production
   destination. Do not paste values into chat or commit them.
2. Confirm the Production Clerk/API pairing with their authorized owners.
   The checked-in canonical URL and a `pk_live_` prefix are validation rules,
   not proof that the remote Clerk instance or API owner approved that pairing.
3. In the authorized Expo/EAS account, inspect existing iOS signing
   credentials and confirm their validity and association with
   `com.bluebirdjets.app`. Use the owner's approved EAS/Apple workflow for any
   later credential changes; this audit made none.
4. Keep `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH` unset until both API and
   Clerk owners approve the Production pairing, token acceptance, and identity
   mapping. After approval, configure the API-owner-verified issuer and enable
   the separate Production provider. Missing or mismatched settings remain a
   sign-in blocker; no legacy-host fallback or Development configuration is
   an acceptable substitute.
5. Confirm the app version/build number and Universal Link association with
   the owner, then run a future owner-authorized iOS build/device-validation
   task. This audit started no build, upload, or submission.
