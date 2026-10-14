# Clerk SMS rate-limit investigation

## Summary

The sign-in adapter now creates an attempt with the phone identifier only, then makes one explicit `prepareFirstFactor({ strategy: 'phone_code', phoneNumberId })` call. This follows Clerk's documented legacy sign-in lifecycle and avoids sending `phone_code` as part of the create request before separately preparing the factor.

The previous UI was not single-flight: it checked React's `busyAction` state and then scheduled a state update. A second button or keyboard event could run against the same render before that update produced a rerender. Each accepted invocation could therefore run its own create and preparation sequence. Resend had the same state-timing gap. A synchronous guard now covers request, verify, and resend actions; React state remains responsible for the visible disabled/busy state.

No automatic retry was added. An error or SMS arriving out of band does not advance the screen: code entry is shown only after Clerk returns a prepared sign-in whose status is `needs_first_factor` and whose first-factor verification is `unverified`.

## Request lifecycle and SDK evidence

- The installed dependencies are `@clerk/expo` 4.10.1 and `@clerk/clerk-js` 6.39.0; Bluebird uses the legacy `useSignIn`/`useSignUp` hooks.
- `ClerkAuthPanel` connects the Send button's `onPress` and phone input's `onSubmitEditing` to the same request handler. Resend has its own handler. The only effect in this panel navigates when Clerk reports an already-signed-in session; it does not create or prepare a sign-in.
- In the installed Clerk JS runtime, `SignIn.create()` posts the supplied create parameters to the sign-in endpoint. `SignIn.prepareFirstFactor()` is a separate action request with `action: 'prepare_first_factor'`. Clerk's legacy `SignIn` reference says the first-factor verification starts empty and requires `prepareFirstFactor()` to start it. The Clerk OTP guide likewise demonstrates `create({ identifier })`, then a single `prepareFirstFactor({ strategy: 'phone_code', phoneNumberId })`.
- Before this change the app supplied both `strategy: 'phone_code'` and the identifier to `create()`, then explicitly prepared the phone factor. The server's behavior for that noncanonical create payload—and whether it produced an SMS itself—is not established by the installed client code. Removing the strategy from create eliminates that ambiguity in the app's request pattern.
- From one accepted handler invocation, the adapter calls `create()` once and `prepareFirstFactor()` once. It does not loop or automatically retry. Before the synchronous guard, rapid repeated events could start multiple invocations, each with its own pair of calls. The mocked regression test confirms that the guard now rejects duplicate button, keyboard-submit, and resend events while the first request is pending.

References:

- [Clerk Expo legacy SignIn object](https://clerk.com/docs/expo/reference/objects/sign-in)
- [Clerk custom SMS OTP flow](https://clerk.com/docs/custom-flows/email-sms-otp)
- Installed source: `node_modules/.pnpm/@clerk+clerk-js@6.39.0_*/node_modules/@clerk/clerk-js/dist/clerk.native.js`

## Diagnostics and user feedback

In Development builds only, each Clerk operation emits one structured `[clerk-phone-auth]` event with its stage, a count scoped to the current screen flow, a sanitized Clerk/resource or HTTP status, and a sanitized error code. Events omit identifiers, phone numbers, codes, tokens, secrets, error messages, and raw responses. The counter resets when a new phone-code request starts and continues through resend, verification, and session activation.

`verification_code_too_many_requests` and related rate-limit codes show a clear wait message. A duration is shown only when Clerk provides a finite, positive `retryAfter` value within the supported one-day bound; otherwise the message advises waiting a few minutes. The message also discourages repeated requests and notes that SMS can be delayed.

## Cause assessment

**Confirmed in code:** duplicate client-side handler invocations were possible before the change because the in-flight check relied only on React state. Also confirmed: the old create request included `strategy: 'phone_code'` immediately before a distinct first-factor preparation action.

**Not confirmed:** this investigation did not establish how many SMS messages Clerk sent for any prior user attempt, whether Clerk acted on `strategy: 'phone_code'` during `create()`, or whether an actual rate-limit response was caused by duplicate requests, delivery delays, provider behavior, or another source. No live SMS request or Clerk Dashboard inspection was performed.

To establish a future live cause, correlate the new sanitized Development events for one user action (stages, per-flow counts, statuses, and codes) with a Clerk-side or network trace that records request timing and action names but excludes phone numbers, codes, tokens, and response bodies. If only one create and one preparation are recorded but multiple SMS arrive, the remaining evidence must come from Clerk's safe server-side request/delivery diagnostics; client events alone cannot attribute it.

## Regression and validation

- `pnpm --filter @workspace/bluebird run test:clerk-phone-auth` — passed, 17 tests. Uses injected synthetic Clerk resources and no network/SMS calls.
- `pnpm --filter @workspace/bluebird run test:clerk-auth-ui` — passed, 5 tests.
- `pnpm exec tsc -b lib/api-client-react` refreshed stale composite TypeScript declarations; `pnpm --filter @workspace/bluebird run typecheck` then passed.
- The duplicate-event regression invokes the exact synchronous guard wired into the component's button, keyboard-submit, and resend handlers, with a deferred synthetic operation. It does not mount Clerk or send network requests.
- No Clerk Dashboard settings, production services, deployment, or publishing were changed.
