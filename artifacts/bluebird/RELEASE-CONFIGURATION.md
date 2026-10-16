# Bluebird iOS release configuration

This note records the owner-provided values needed before an iOS production build and App Store submission. No app identity, EAS project, credentials, or production environment values are created here.

## Production EAS environment

Configure the named EAS `production` environment with these public app-configuration variables:

- `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT` must select `production`.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL` must identify the Production Main Bluebird API. The mobile configuration accepts only its configured canonical HTTPS `/api` endpoint.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY` must be the Production Clerk publishable key (`pk_live_…`) for the Clerk instance paired with that API.

The API URL, environment selector, and Clerk publishable key are embedded in the mobile app configuration; they are not server secrets. The publishable key is public by design but must belong to the correct Production Clerk instance. Do not put private keys, API tokens, or other server credentials in `EXPO_PUBLIC_` variables or in this repository. Keep any genuine secrets in an approved secret store.

## Owner inputs required

- Confirm the exact unique reverse-DNS iOS bundle identifier and set `expo.ios.bundleIdentifier` in `app.json`. It is intentionally unset; do not derive it from the app name or website.
- Supply the App Store Connect app's numeric Apple ID (`ascAppId`) if submission should be non-interactive. No App Store Connect app ID is available in this project.
- Provide authorized Apple Developer / App Store Connect access and configure signing/submission credentials through EAS when the owner is ready. Do not commit Apple credentials or add guessed team/account values here.
- Create or link the EAS project only after the owner approves the app identity and project ownership. No EAS project ID is configured.

The `submit.production` profile intentionally leaves `ios` values empty until those owner inputs are available; EAS Submit can prompt for missing values interactively.
