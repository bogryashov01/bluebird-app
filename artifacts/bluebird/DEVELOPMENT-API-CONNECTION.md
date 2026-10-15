# Bluebird Development API connection check

The signed-in Development screen has one explicit, confirmed check: `GET /api/me`
against the validated Development API base URL. It uses the matching Development
Clerk session and sends one bearer-authenticated request. No request is made at
startup, and the check does not use the Production API.

The diagnostic retains only the target origin and path plus an allowlisted
summary of the request method, header names, credentials mode, abort signal,
timeout, Fetch receiver, and execution platform. It never retains token values,
cookies, response bodies, or raw exceptions. “Fetch invoked” means the client
called Fetch; it does not prove the target received the request. A missing HTTP
response with an ambiguous browser transport failure must be investigated with
the Preview’s DevTools Network/Console and the target API’s access logs. Do not
infer CORS, DNS, or TLS from a Fetch rejection alone.

The authenticated transport must invoke Fetch with `globalThis` as its receiver.
Calling a captured Fetch function as `options.fetcher(...)` binds `this` to the
request-options object; browsers reject that invocation with a `TypeError`,
which the transport sanitizes as an ambiguous network failure.

The checked-in API server installs `cors({ origin: true, credentials: true })`
before its routes. If the actual Development target is confirmed by DevTools to
be failing browser CORS and is not running equivalent middleware, the API-side
change required is to allow the actual Bluebird Development Preview origin for
`GET /api/me` and answer its `OPTIONS /api/me` preflight with that allowed
origin, `GET`, and the requested `Authorization` and `Accept` headers. Do not
add a token-forwarding proxy or change the API based only on an ambiguous Fetch
failure.

The corrected authenticated-client transport received HTTP 200 from the
configured Development API in a browser at the Expo Preview origin using a
test bearer. The response projection reported `isAuthenticated: false`, so this
confirms response receipt without proving acceptance of the current Clerk
Development session or resolving a Bluebird member identity. The automated
Preview browser has no Clerk session, so the signed-in Development button flow
still needs a real Clerk-session run to verify those separately.
