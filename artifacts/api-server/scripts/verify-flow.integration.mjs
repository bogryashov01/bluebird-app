/**
 * Integration test for the email-verification signup flow.
 *
 * Simulates: register → app relaunch (fresh /auth/me fetch, the source of
 * truth the mobile root route gates on) → failed verification attempts →
 * resend/rotate → successful verification.
 *
 * Run with the API server up:  node scripts/verify-flow.integration.mjs
 * Base URL defaults to the dev domain proxy; override with API_BASE.
 */
const BASE = process.env.API_BASE
  ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : 'http://localhost:3001/api');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failures++;
}

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const email = `verify-flow.${Date.now()}@test.local`;

// 1. Register with first/last name
const reg = await req('/auth/register', {
  method: 'POST',
  body: { firstName: 'Verify', lastName: 'Flow', email, password: 'secret123' },
});
check('register succeeds', reg.status === 201, JSON.stringify(reg.json));
check('register stores full name', reg.json?.user?.name === 'Verify Flow');
check('register returns demo verification token', typeof reg.json?.demoVerificationToken === 'string' && reg.json.demoVerificationToken.length >= 32);
check('user starts unverified', reg.json?.user?.emailVerified === false);
check('response does not leak token hash', !('verificationTokenHash' in (reg.json?.user ?? {})));
const jwt = reg.json?.token;
const firstToken = reg.json?.demoVerificationToken;

// 1b. Register with legacy single `name` field (older clients)
const legacyEmail = `verify-flow.legacy.${Date.now()}@test.local`;
const legacyReg = await req('/auth/register', {
  method: 'POST',
  body: { name: 'Legacy Name', email: legacyEmail, password: 'secret123' },
});
check('legacy name register succeeds', legacyReg.status === 201, JSON.stringify(legacyReg.json));
check('legacy name stored as-is', legacyReg.json?.user?.name === 'Legacy Name');

// 1c. Register with no name at all is rejected
const noName = await req('/auth/register', {
  method: 'POST',
  body: { email: `verify-flow.noname.${Date.now()}@test.local`, password: 'secret123' },
});
check('missing name rejected with 400', noName.status === 400, JSON.stringify(noName.json));

// 1d. firstName only (no lastName) is accepted and stored without trailing space
const firstOnlyEmail = `verify-flow.first.${Date.now()}@test.local`;
const firstOnly = await req('/auth/register', {
  method: 'POST',
  body: { firstName: 'Solo', email: firstOnlyEmail, password: 'secret123' },
});
check('firstName-only register succeeds', firstOnly.status === 201, JSON.stringify(firstOnly.json));
check('firstName-only stored correctly', firstOnly.json?.user?.name === 'Solo');

// 2. "Relaunch": a fresh session fetches /auth/me — must still be unverified,
// so the app's root route redirects to the verify-email screen, not Discover.
const me = await req('/auth/me', { token: jwt });
check('relaunch /auth/me still unverified (root route must gate to verify-email)', me.status === 200 && me.json?.emailVerified === false);

// 2b. Deep-link bypass: protected member operations reject unverified sessions
const gated = await req('/queue/join', { method: 'POST', token: jwt, body: { flightId: 'any', passengers: 1 } });
check('unverified session blocked from protected operation (403)', gated.status === 403, JSON.stringify(gated.json));
const gatedUpgrade = await req('/membership/upgrade', { method: 'POST', token: jwt, body: { tier: 'plus' } });
check('unverified session blocked from membership upgrade (403)', gatedUpgrade.status === 403, JSON.stringify(gatedUpgrade.json));
const gatedProfile = await req('/auth/me', { method: 'PATCH', token: jwt, body: { name: 'New Name' } });
check('unverified session blocked from profile update (403)', gatedProfile.status === 403, JSON.stringify(gatedProfile.json));
// Allowed while unverified (documented exceptions): /auth/me read, resend, verify, logout.

// 3. Wrong token is rejected
const bad = await req('/auth/verify-email', { method: 'POST', token: jwt, body: { token: 'bogus' } });
check('wrong token rejected with 400', bad.status === 400);

// 4. Missing token rejected
const missing = await req('/auth/verify-email', { method: 'POST', token: jwt, body: {} });
check('missing token rejected with 400', missing.status === 400);

// 5. Resend rotates the token; the old token stops working
const resend = await req('/auth/resend-verification', { method: 'POST', token: jwt });
check('resend returns a new token', resend.status === 200 && typeof resend.json?.demoVerificationToken === 'string');
const secondToken = resend.json?.demoVerificationToken;
check('resend rotates the token', secondToken !== firstToken);
const stale = await req('/auth/verify-email', { method: 'POST', token: jwt, body: { token: firstToken } });
check('rotated-out token rejected', stale.status === 400);

// 6. Correct token verifies and is single-use — fire two concurrent requests
// with the same valid token: exactly one may succeed (atomic consumption).
const [c1, c2] = await Promise.all([
  req('/auth/verify-email', { method: 'POST', token: jwt, body: { token: secondToken } }),
  req('/auth/verify-email', { method: 'POST', token: jwt, body: { token: secondToken } }),
]);
const successes = [c1, c2].filter((r) => r.status === 200);
check('exactly one concurrent verification succeeds', successes.length === 1, `statuses ${c1.status}/${c2.status}`);
const ok = successes[0];
check('correct token verifies email', ok?.json?.emailVerified === true);
check('verified user includes referralCode', typeof ok?.json?.referralCode === 'string');

// 6b. Sequential replay of the consumed token is rejected
const replay = await req('/auth/verify-email', { method: 'POST', token: jwt, body: { token: secondToken } });
check('replayed consumed token rejected with 400', replay.status === 400, JSON.stringify(replay.json));

// 7. After verification, /auth/me reflects the flag (root route now allows Discover)
const me2 = await req('/auth/me', { token: jwt });
check('post-verification /auth/me is verified', me2.status === 200 && me2.json?.emailVerified === true);

// 7b. After verification the gate lifts (no longer 403; other validation may still apply)
const ungated = await req('/queue/join', { method: 'POST', token: jwt, body: { flightId: 'nonexistent-flight', passengers: 1 } });
check('verified session passes the verification gate', ungated.status !== 403, `status ${ungated.status}`);

// 8. Unauthenticated calls are rejected
const noAuth = await req('/auth/verify-email', { method: 'POST', body: { token: secondToken } });
check('verify without auth rejected', noAuth.status === 401);
const noAuthResend = await req('/auth/resend-verification', { method: 'POST' });
check('resend-verification without auth rejected', noAuthResend.status === 401);

// 9. Resend for an already-verified account is a no-op message, no new token
const resendVerified = await req('/auth/resend-verification', { method: 'POST', token: jwt });
check('resend after verification reports already verified', resendVerified.status === 200 && resendVerified.json?.demoVerificationToken === undefined, JSON.stringify(resendVerified.json));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
