# Native referral attribution lifecycle

1. Opening `/join/{code}` normalizes and stores a valid `BB-` code in native AsyncStorage before routing to signup. The signup, phone verification, and registration screens may also restore that value after a navigation or app interruption.
2. The mobile legacy sign-in/registration API is not used to validate or award referral credit. The Production referral repository validates through `POST /api/invites/validate` and previews a membership discount through `POST /api/membership/preview-pricing` using the currently selected, environment-matched Main API and Clerk session.
3. The pending code remains stored through signup and plan browsing. A future supported membership activation request can read and pass that code as its invite attribution; this app currently has no membership activation contract or checkout action, so it does not activate a membership or process payment.
4. Clear the stored code only after the Main API confirms that the activation request consumed it, or when the user explicitly discards the referral. Do not clear it on app restart, sign-in completion, plan selection, preview failure, or an unconfirmed response.

No browser cookie is used for native attribution.
