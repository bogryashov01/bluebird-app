# Bluebird Development API connection check

The signed-in Development screen has one explicit, confirmed check: `GET /api/me`
against the validated Development API base URL. It uses the matching Development
Clerk session and sends one bearer-authenticated request. No request is made at
startup, and the check does not use the Production API.

The diagnostic retains only the target origin and path. “Fetch invoked” means
the client called Fetch; it does not prove the target received the request. A
missing HTTP response with an ambiguous browser transport failure must be
investigated with the Preview’s DevTools Network/Console and the target API’s
access logs. Do not infer CORS, DNS, or TLS from a Fetch rejection alone.

The checked-in API server installs `cors({ origin: true, credentials: true })`
before its routes. If the actual Development target is confirmed by DevTools to
be failing browser CORS and is not running equivalent middleware, the API-side
change required is to allow the actual Bluebird Development Preview origin for
`GET /api/me` and answer its `OPTIONS /api/me` preflight with that allowed
origin, `GET`, and the requested `Authorization` and `Accept` headers. Do not
add a token-forwarding proxy or change the API based only on an ambiguous Fetch
failure.

The signed-in diagnostic could not be exercised in the automated Preview
capture because that browser has no Clerk session. Its API-arrival status
therefore remains unverified until a signed-in Development Preview check is
correlated with the Development API logs.
