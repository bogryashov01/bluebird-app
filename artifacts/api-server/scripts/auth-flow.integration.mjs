/**
 * Integration test for the phone + SMS PIN authentication flow.
 *
 * Covers: phone normalization, resend cooldown, wrong-code attempts and
 * exhaustion, expiry, single-use/replay (including concurrent verification),
 * auto account creation for new phones vs. sign-in for existing ones, and
 * the logout token denylist.
 *
 * Run with the API server up (development):  pnpm run test:auth-flow
 * Base URL defaults to the dev domain proxy; override with API_BASE.
 * Needs DATABASE_URL to fast-forward cooldowns/expiry (no real waiting).
 */
import { createRequire } from "node:module";
// Borrow the pg driver from the db workspace package (this script has no deps of its own).
const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

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

// Unique per-run test phone (area code 555 test range, random suffix)
const suffix = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
const rawPhone = `(555) ${suffix.slice(0, 3)}-${suffix.slice(3)}`; // formatted input
const normalized = `+1555${suffix}`;

// 1. Request a code with a formatted (non-normalized) phone string
const reqCode = await req('/auth/request-code', { method: 'POST', body: { phone: rawPhone } });
check('request-code succeeds', reqCode.status === 200, JSON.stringify(reqCode.json));
check('phone is normalized to E.164', reqCode.json?.phone === normalized, `got ${reqCode.json?.phone}`);
check('demo code returned (non-production)', /^\d{6}$/.test(reqCode.json?.demoCode ?? ''), JSON.stringify(reqCode.json));
const firstCode = reqCode.json?.demoCode;

// 1b. Invalid phone rejected
const badPhone = await req('/auth/request-code', { method: 'POST', body: { phone: '123' } });
check('invalid phone rejected with 400', badPhone.status === 400);

// 2. Immediate re-request hits the resend cooldown (429)
const tooSoon = await req('/auth/request-code', { method: 'POST', body: { phone: normalized } });
check('immediate resend blocked by cooldown (429)', tooSoon.status === 429, JSON.stringify(tooSoon.json));

// 2b. Concurrent cooldown race: fast-forward the cooldown, then fire 6
// simultaneous requests — the atomic conditional upsert must let exactly one
// win; the rest get 429 (no SMS-flood bypass).
await pool.query(`UPDATE login_codes SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE phone = $1`, [normalized]);
const burst = await Promise.all(Array.from({ length: 6 }, () =>
  req('/auth/request-code', { method: 'POST', body: { phone: normalized } })));
const issuedCount = burst.filter((r) => r.status === 200).length;
check('exactly one concurrent request-code wins the cooldown', issuedCount === 1,
  `statuses ${burst.map((r) => r.status).join('/')}`);
// Sync back to the single issued code for the wrong-code tests below.
const winner = burst.find((r) => r.status === 200);
const activeCode = winner?.json?.demoCode ?? firstCode;

// 3. Wrong code shows an error and counts an attempt
const wrong = await req('/auth/verify-code', { method: 'POST', body: { phone: rawPhone, code: activeCode === '000000' ? '000001' : '000000' } });
check('wrong code rejected with 401', wrong.status === 401, JSON.stringify(wrong.json));

// 3b. Malformed code rejected up-front
const malformed = await req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: '12ab' } });
check('malformed code rejected with 400', malformed.status === 400);

// 4. Correct code signs in and auto-creates the account — fire two concurrent
// verifications with the same valid code: exactly one may succeed (single-use).
const [c1, c2] = await Promise.all([
  req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: activeCode } }),
  req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: activeCode } }),
]);
const successes = [c1, c2].filter((r) => r.status === 200);
check('exactly one concurrent verification succeeds', successes.length === 1, `statuses ${c1.status}/${c2.status}`);
const ok = successes[0];
check('verification returns a JWT', typeof ok?.json?.token === 'string');
check('first-time phone auto-creates the account', ok?.json?.isNewUser === true);
check('user record carries the normalized phone', ok?.json?.user?.phone === normalized);
check('user has a referral code', typeof ok?.json?.user?.referralCode === 'string');
const jwt = ok?.json?.token;

// 4b. Sequential replay of the consumed code is rejected
const replay = await req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: activeCode } });
check('replayed consumed code rejected', replay.status === 401, JSON.stringify(replay.json));

// 5. /auth/me works with the issued token
const me = await req('/auth/me', { token: jwt });
check('/auth/me returns the member', me.status === 200 && me.json?.phone === normalized);

// 6. Returning member: request a new code (fast-forward the cooldown via DB),
// verify, and confirm it signs into the SAME account without creating a new one.
await pool.query(`UPDATE login_codes SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE phone = $1`, [normalized]);
const reqCode2 = await req('/auth/request-code', { method: 'POST', body: { phone: normalized } });
check('resend works after cooldown', reqCode2.status === 200 && /^\d{6}$/.test(reqCode2.json?.demoCode ?? ''));
check('resend rotates the code', reqCode2.json?.demoCode !== activeCode);
const login2 = await req('/auth/verify-code', { method: 'POST', body: { phone: rawPhone, code: reqCode2.json.demoCode } });
check('returning member signs into the same account', login2.status === 200 && login2.json?.user?.id === ok?.json?.user?.id);
check('returning member is not flagged as new', login2.json?.isNewUser === false);

// 7. Expired codes are rejected (age the row via DB instead of waiting 5 min)
await pool.query(`UPDATE login_codes SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE phone = $1`, [normalized]);
const reqCode3 = await req('/auth/request-code', { method: 'POST', body: { phone: normalized } });
await pool.query(`UPDATE login_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE phone = $1`, [normalized]);
const expired = await req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: reqCode3.json.demoCode } });
check('expired code rejected', expired.status === 401, JSON.stringify(expired.json));

// 8. Attempt exhaustion: 5 wrong guesses invalidate the code entirely
await pool.query(`DELETE FROM login_codes WHERE phone = $1`, [normalized]);
const reqCode4 = await req('/auth/request-code', { method: 'POST', body: { phone: normalized } });
const realCode = reqCode4.json?.demoCode;
const wrongGuess = realCode === '000000' ? '000001' : '000000';
let lockedOut = false;
for (let i = 0; i < 5; i++) {
  const r = await req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: wrongGuess } });
  if (r.json?.error?.includes('Too many attempts')) lockedOut = true;
}
check('5th wrong guess reports lock-out', lockedOut);
const afterLock = await req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: realCode } });
check('correct code rejected after exhaustion (code invalidated)', afterLock.status === 401, JSON.stringify(afterLock.json));

// 8b. Concurrent attempt-cap race: fire 10 wrong guesses in parallel — the
// conditional increment must stop the count at the cap, and the real code
// must be rejected afterwards (no bypass under concurrency).
await pool.query(`DELETE FROM login_codes WHERE phone = $1`, [normalized]);
const reqCode5 = await req('/auth/request-code', { method: 'POST', body: { phone: normalized } });
const realCode5 = reqCode5.json?.demoCode;
const wrongGuess5 = realCode5 === '000000' ? '000001' : '000000';
await Promise.all(Array.from({ length: 10 }, () =>
  req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: wrongGuess5 } })));
const { rows } = await pool.query(`SELECT attempts FROM login_codes WHERE phone = $1`, [normalized]);
check('concurrent guesses never push attempts past the cap', (rows[0]?.attempts ?? 0) <= 5, `attempts=${rows[0]?.attempts}`);
const afterRace = await req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: realCode5 } });
check('correct code rejected after concurrent exhaustion', afterRace.status === 401, JSON.stringify(afterRace.json));

// 8c. International number: request + verify with a "+" formatted number the
// mobile client would send (regression: intl users must be able to sign in).
const intlPhone = `+4420${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
const intlReq = await req('/auth/request-code', { method: 'POST', body: { phone: intlPhone } });
check('international request-code succeeds', intlReq.status === 200 && intlReq.json?.phone === intlPhone, JSON.stringify(intlReq.json));
const intlVerify = await req('/auth/verify-code', { method: 'POST', body: { phone: intlPhone, code: intlReq.json?.demoCode } });
check('international sign-in succeeds', intlVerify.status === 200 && intlVerify.json?.user?.phone === intlPhone, JSON.stringify(intlVerify.json));
await pool.query(`DELETE FROM login_codes WHERE phone = $1`, [intlPhone]);

// 9. Logout revokes the token (denylist)
const logout = await req('/auth/logout', { method: 'POST', token: jwt });
check('logout succeeds', logout.status === 200);
const meAfter = await req('/auth/me', { token: jwt });
check('revoked token rejected after logout', meAfter.status === 401);

await pool.query(`DELETE FROM login_codes WHERE phone = $1`, [normalized]);
await pool.end();

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
