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
the browser DevTools Network/Console and the target API’s access logs. Do not
infer CORS, DNS, or TLS from a Fetch rejection alone.

The authenticated transport must invoke Fetch with `globalThis` as its receiver.
Calling a captured Fetch function as `options.fetcher(...)` binds `this` to the
request-options object; browsers reject that invocation with a `TypeError`,
which the transport sanitizes as an ambiguous network failure.

The checked-in API server installs `cors({ origin: true, credentials: true })`
before its routes. If the actual Development target is confirmed by DevTools to
be failing browser CORS and is not running equivalent middleware, the API-side
change required is to allow the actual Bluebird Expo web development origin for
`GET /api/me` and answer its `OPTIONS /api/me` preflight with that allowed
origin, `GET`, and the requested `Authorization` and `Accept` headers. Do not
add a token-forwarding proxy or change the API based only on an ambiguous Fetch
failure.

The corrected authenticated-client transport received HTTP 200 from the
configured Development API in a browser at the Expo web development origin using a
test bearer. The response projection reported `isAuthenticated: false`, so this
confirms response receipt without proving acceptance of the current Clerk
Development session or resolving a Bluebird member identity. The automated
browser has no Clerk session, so the signed-in Development button flow
still needs a real Clerk-session run to verify those separately.

## Development preflight observation (2026-10-16)

For the running Expo web development origin
`https://cd8d8a20-320c-4224-accf-5c9dc7df2ff1-00-1ud53d7apx2xl-myfpo1zd.expo.worf.replit.dev`
and selected Development API origin
`https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev`,
a credential-free `OPTIONS /api/me` was sent with:

- `Origin`: the Preview origin above
- `Access-Control-Request-Method`: `GET`
- `Access-Control-Request-Headers`: `authorization,accept`

It returned `204 No Content` with `Access-Control-Allow-Origin` matching the
Preview origin, `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE`,
`Access-Control-Allow-Headers: authorization,accept`, and
`Access-Control-Allow-Credentials: true`. `Vary` included `Origin` and
`Access-Control-Request-Headers`. The observed response therefore allows this
preflight; the earlier missing-allow-origin browser report was not reproduced
for the current origin pair.

The Development API/Clerk selection is explicit, Clerk auth is enabled, and the
configured Development issuer matches the Development publishable-key instance.
The preflight did not send credentials and did not exercise authentication.
Remote Development API access logs were not available, so the response cannot
be attributed conclusively to the API application versus an intermediary; no
authentication rejection was observed. The checked-in API middleware is
configured to reflect the request origin and allow credentials before routing.
No Mobile transport or API configuration change is indicated by this capture.
The automated browser has no signed-in Clerk session, so a real authenticated
browser `GET /api/me` and its authentication acceptance remain unverified.
