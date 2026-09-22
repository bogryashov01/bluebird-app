/**
 * Integration test for the phone + SMS PIN authentication flow.
 *
 * Covers: phone normalization, resend cooldown, wrong-code attempts and
 * exhaustion, expiry, single-use/replay (including concurrent verification),
 * registration grants for new phones vs. immediate sign-in for existing ones,
 * atomic grant consumption, profile conflicts, and the logout token denylist.
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

// Canonical grouped catalog is available before authentication and includes
// airports that do not need to exist in current flight inventory.
const airportList = await req('/flights/airports');
const dallas = airportList.json?.find?.((group) => group.city === 'Dallas');
const newYork = airportList.json?.find?.((group) => group.city === 'New York');
check('airport list returns grouped canonical metadata',
  airportList.status === 200 && Array.isArray(dallas?.airports) && Array.isArray(newYork?.airports),
  JSON.stringify(airportList.json));
check('Dallas contains DFW and DAL independent of inventory',
  JSON.stringify(dallas?.airports?.map((airport) => airport.code)) === JSON.stringify(['DFW', 'DAL']));
check('New York contains TEB, JFK, LGA, and EWR',
  JSON.stringify(newYork?.airports?.map((airport) => airport.code)) === JSON.stringify(['TEB', 'JFK', 'LGA', 'EWR']));

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

// 4. Correct code verifies the unknown phone without creating an account.
// Fire two concurrent verifications: exactly one may succeed (single-use).
const [c1, c2] = await Promise.all([
  req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: activeCode } }),
  req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: activeCode } }),
]);
const successes = [c1, c2].filter((r) => r.status === 200);
check('exactly one concurrent verification succeeds', successes.length === 1, `statuses ${c1.status}/${c2.status}`);
const ok = successes[0];
check('unknown phone requires registration', ok?.json?.outcome === 'registration_required', JSON.stringify(ok?.json));
check('verification returns no session or user', !ok?.json?.token && !ok?.json?.user);
check('verification returns a registration grant', typeof ok?.json?.registrationGrant === 'string');
const registrationGrant = ok?.json?.registrationGrant;
const beforeRegistration = await pool.query(`SELECT id FROM users WHERE phone = $1`, [normalized]);
check('verification alone does not create an account', beforeRegistration.rowCount === 0);

// 4b. Sequential replay of the consumed code is rejected
const replay = await req('/auth/verify-code', { method: 'POST', body: { phone: normalized, code: activeCode } });
check('replayed consumed code rejected', replay.status === 401, JSON.stringify(replay.json));

// 4c. Invalid profile data does not consume the verified flow.
const invalidProfile = await req('/auth/complete-registration', {
  method: 'POST',
  body: { registrationGrant, firstName: '', lastName: 'Member', email: 'invalid' },
});
check('invalid registration profile rejected', invalidProfile.status === 400, JSON.stringify(invalidProfile.json));
const grantAfterInvalid = await pool.query(`SELECT grant_hash FROM registration_grants WHERE phone = $1`, [normalized]);
check('validation failure preserves registration grant', grantAfterInvalid.rowCount === 1);

// 4d. Registration consumes the grant and creates the account atomically.
const profile = { registrationGrant, firstName: 'Auth', lastName: 'Tester', email: `auth-${suffix}@example.test` };
const [r1, r2] = await Promise.all([
  req('/auth/complete-registration', { method: 'POST', body: profile }),
  req('/auth/complete-registration', { method: 'POST', body: profile }),
]);
const registrations = [r1, r2].filter((r) => r.status === 200);
check('exactly one concurrent registration succeeds', registrations.length === 1, `statuses ${r1.status}/${r2.status}`);
const registered = registrations[0];
check('registration returns a JWT', typeof registered?.json?.token === 'string');
check('registered user carries normalized phone and full name',
  registered?.json?.user?.phone === normalized && registered?.json?.user?.name === 'Auth Tester');
check('registered user has the submitted email', registered?.json?.user?.email === profile.email);
check('new account starts as a non-member', registered?.json?.user?.membershipTier === 'none');
check('registered user always has homeAirports', Array.isArray(registered?.json?.user?.homeAirports));
const jwt = registered?.json?.token;

const grantReplay = await req('/auth/complete-registration', { method: 'POST', body: profile });
check('consumed registration grant cannot be replayed', grantReplay.status === 401, JSON.stringify(grantReplay.json));

// 5. /auth/me works with the issued token.
const me = await req('/auth/me', { token: jwt });
check('/auth/me returns the member', me.status === 200 && me.json?.phone === normalized);
check('/auth/me returns homeAirports and not the legacy field',
  Array.isArray(me.json?.homeAirports) && !Object.hasOwn(me.json ?? {}, 'homeAirport'));
check('/auth/me defaults notification delivery to app',
  me.json?.notificationChannel === 'app');

// 5b. Preferred airports are normalized, deduplicated, and are not limited to
// airports represented in current flight inventory (DFW/LGA).
const updatedPrefs = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { homeAirports: ['dfw', 'DAL', 'DFW', ' lga '] },
});
check('PATCH /auth/me saves multiple canonical airports',
  updatedPrefs.status === 200
    && JSON.stringify(updatedPrefs.json?.homeAirports) === JSON.stringify(['DFW', 'DAL', 'LGA']),
  JSON.stringify(updatedPrefs.json));
const invalidPrefs = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { homeAirports: ['XYZ'] },
});
check('PATCH /auth/me rejects airports outside the catalog', invalidPrefs.status === 400);
const invalidPrefsShape = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { homeAirports: 'DAL' },
});
check('PATCH /auth/me rejects a non-array preference', invalidPrefsShape.status === 400);

// 5c. Optional account weight accepts fractional values, persists through a
// fresh user read, and can be cleared without affecting passenger manifests.
const validWeight = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { weightKg: 72.5 },
});
check('PATCH /auth/me saves a fractional account weight',
  validWeight.status === 200 && validWeight.json?.weightKg === 72.5,
  JSON.stringify(validWeight.json));
const meWithWeight = await req('/auth/me', { token: jwt });
check('account weight persists through a fresh /auth/me request',
  meWithWeight.status === 200 && meWithWeight.json?.weightKg === 72.5,
  JSON.stringify(meWithWeight.json));
const blankWeight = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { weightKg: null },
});
check('PATCH /auth/me clears account weight with null',
  blankWeight.status === 200 && blankWeight.json?.weightKg === null,
  JSON.stringify(blankWeight.json));
const zeroWeight = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { weightKg: 0 },
});
check('PATCH /auth/me rejects zero account weight', zeroWeight.status === 400, JSON.stringify(zeroWeight.json));
const nonNumericWeight = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { weightKg: 'not-a-number' },
});
check('PATCH /auth/me rejects non-numeric account weight', nonNumericWeight.status === 400, JSON.stringify(nonNumericWeight.json));
const overWeight = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { weightKg: 501 },
});
check('PATCH /auth/me rejects account weight over 500 kg', overWeight.status === 400, JSON.stringify(overWeight.json));
const maxWeight = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { weightKg: 500 },
});
check('PATCH /auth/me accepts the 500 kg upper bound',
  maxWeight.status === 200 && maxWeight.json?.weightKg === 500,
  JSON.stringify(maxWeight.json));
const omittedWeight = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { name: 'Auth Tester' },
});
check('PATCH /auth/me leaves weight unchanged when omitted',
  omittedWeight.status === 200 && omittedWeight.json?.weightKg === 500,
  JSON.stringify(omittedWeight.json));
// 5c. Notification delivery preference is account-scoped and validated.
for (const channel of ['email', 'both', 'app']) {
  const updatedChannel = await req('/auth/me', {
    method: 'PATCH',
    token: jwt,
    body: { notificationChannel: channel },
  });
  check(`PATCH /auth/me saves notification channel ${channel}`,
    updatedChannel.status === 200 && updatedChannel.json?.notificationChannel === channel,
    JSON.stringify(updatedChannel.json));
}
const invalidChannel = await req('/auth/me', {
  method: 'PATCH',
  token: jwt,
  body: { notificationChannel: 'push' },
});
check('PATCH /auth/me rejects an unknown notification channel',
  invalidChannel.status === 400,
  JSON.stringify(invalidChannel.json));

// 6. Returning member: request a new code (fast-forward the cooldown via DB),
// verify, and confirm it signs into the SAME account without creating a new one.
await pool.query(`UPDATE login_codes SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE phone = $1`, [normalized]);
const reqCode2 = await req('/auth/request-code', { method: 'POST', body: { phone: normalized } });
check('resend works after cooldown', reqCode2.status === 200 && /^\d{6}$/.test(reqCode2.json?.demoCode ?? ''));
check('resend rotates the code', reqCode2.json?.demoCode !== activeCode);
const login2 = await req('/auth/verify-code', { method: 'POST', body: { phone: rawPhone, code: reqCode2.json.demoCode } });
check('returning member signs into the same account', login2.status === 200 && login2.json?.user?.id === registered?.json?.user?.id);
check('returning member receives an immediate session', login2.json?.outcome === 'signed_in' && typeof login2.json?.token === 'string');
check('airport preferences persist on the member account',
  JSON.stringify(login2.json?.user?.homeAirports) === JSON.stringify(['DFW', 'DAL', 'LGA']));
check('signed-in user response includes the saved account weight',
  login2.json?.user?.weightKg === 500,
  JSON.stringify(login2.json));
check('notification delivery preference persists on the member account',
  login2.json?.user?.notificationChannel === 'app');

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

// 8c. Expired registration grants cannot create accounts.
const grantPhone = `+1556${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
const grantCode = await req('/auth/request-code', { method: 'POST', body: { phone: grantPhone } });
const grantVerify = await req('/auth/verify-code', { method: 'POST', body: { phone: grantPhone, code: grantCode.json?.demoCode } });
await pool.query(`UPDATE registration_grants SET expires_at = NOW() - INTERVAL '1 minute' WHERE phone = $1`, [grantPhone]);
const expiredGrant = await req('/auth/complete-registration', {
  method: 'POST',
  body: { registrationGrant: grantVerify.json?.registrationGrant, firstName: 'Expired', lastName: 'Grant', email: `expired-${suffix}@example.test` },
});
check('expired registration grant rejected', expiredGrant.status === 401, JSON.stringify(expiredGrant.json));
const noExpiredUser = await pool.query(`SELECT id FROM users WHERE phone = $1`, [grantPhone]);
check('expired grant creates no account', noExpiredUser.rowCount === 0);

// 8d. Conflicting email is clear and leaves the grant retryable.
const conflictPhone = `+1557${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
const conflictCode = await req('/auth/request-code', { method: 'POST', body: { phone: conflictPhone } });
const conflictVerify = await req('/auth/verify-code', { method: 'POST', body: { phone: conflictPhone, code: conflictCode.json?.demoCode } });
const conflict = await req('/auth/complete-registration', {
  method: 'POST',
  body: { registrationGrant: conflictVerify.json?.registrationGrant, firstName: 'Email', lastName: 'Conflict', email: profile.email.toUpperCase() },
});
check('duplicate email rejected with conflict', conflict.status === 409, JSON.stringify(conflict.json));
const grantAfterConflict = await pool.query(`SELECT grant_hash FROM registration_grants WHERE phone = $1`, [conflictPhone]);
check('email conflict preserves registration grant', grantAfterConflict.rowCount === 1);

// 8e. International number: request + verify with a "+" formatted number the
// mobile client would send.
const intlPhone = `+4420${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
const intlReq = await req('/auth/request-code', { method: 'POST', body: { phone: intlPhone } });
check('international request-code succeeds', intlReq.status === 200 && intlReq.json?.phone === intlPhone, JSON.stringify(intlReq.json));
const intlVerify = await req('/auth/verify-code', { method: 'POST', body: { phone: intlPhone, code: intlReq.json?.demoCode } });
check('international phone verification succeeds', intlVerify.status === 200 && intlVerify.json?.outcome === 'registration_required', JSON.stringify(intlVerify.json));
await pool.query(`DELETE FROM login_codes WHERE phone = $1`, [intlPhone]);
await pool.query(`DELETE FROM registration_grants WHERE phone IN ($1, $2, $3)`, [intlPhone, grantPhone, conflictPhone]);

// 9. Logout revokes the token (denylist)
const logout = await req('/auth/logout', { method: 'POST', token: jwt });
check('logout succeeds', logout.status === 200);
const meAfter = await req('/auth/me', { token: jwt });
check('revoked token rejected after logout', meAfter.status === 401);

await pool.query(`DELETE FROM login_codes WHERE phone = $1`, [normalized]);
await pool.end();

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
