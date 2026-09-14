/**
 * Integration coverage for pass-based referral attribution.
 * Run with the development API workflow up: pnpm run test:referral-flow
 */
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const BASE = process.env.API_BASE
  ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : "http://localhost:3001/api");

let failures = 0;
function check(name, condition, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${extra}`}`);
  if (!condition) failures++;
}

async function req(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function registrationGrant(phone) {
  const issued = await req("/auth/request-code", { method: "POST", body: { phone } });
  const verified = await req("/auth/verify-code", {
    method: "POST",
    body: { phone, code: issued.json?.demoCode },
  });
  return verified.json?.registrationGrant;
}

const suffix = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
const inviterId = `ref-inviter-${suffix}`;
const secondInviterId = `ref-inviter-two-${suffix}`;
const inviterPhone = `+15580${suffix}`;
const secondInviterPhone = `+15581${suffix}`;
const friendPhone = `+15582${suffix}`;
const invalidPhone = `+15583${suffix}`;
const inviterCode = `FLY${suffix}`;
const secondInviterCode = `JET${suffix}`;
const ids = [inviterId, secondInviterId];
const phones = [inviterPhone, secondInviterPhone, friendPhone, invalidPhone];

await pool.query(
  `INSERT INTO users
    (id, name, phone, email, membership_tier, line_pass_count, referral_code, home_airports)
   VALUES
    ($1, 'Referral Inviter', $2, $3, 'base', 0, $4, ARRAY[]::TEXT[]),
    ($5, 'Second Inviter', $6, $7, 'base', 0, $8, ARRAY[]::TEXT[])`,
  [
    inviterId, inviterPhone, `inviter-${suffix}@example.test`, inviterCode,
    secondInviterId, secondInviterPhone, `inviter-two-${suffix}@example.test`, secondInviterCode,
  ],
);
let duplicateCodeRejected = false;
try {
  await pool.query(
    `INSERT INTO users
      (id, name, phone, email, membership_tier, line_pass_count, referral_code, home_airports)
     VALUES ($1, 'Code Collision', $2, $3, 'base', 0, $4, ARRAY[]::TEXT[])`,
    [`ref-collision-${suffix}`, `+15584${suffix}`, `collision-${suffix}@example.test`, inviterCode],
  );
} catch (error) {
  duplicateCodeRejected = error?.code === "23505";
}
check("referral codes are unique at the database boundary", duplicateCodeRejected);

const grant = await registrationGrant(friendPhone);
const profile = {
  registrationGrant: grant,
  firstName: "Referral",
  lastName: "Friend",
  email: `friend-${suffix}@example.test`,
  referralCode: inviterCode.toLowerCase(),
};
const [first, retry] = await Promise.all([
  req("/auth/complete-registration", { method: "POST", body: profile }),
  req("/auth/complete-registration", { method: "POST", body: profile }),
]);
const successful = [first, retry].find((result) => result.status === 200);
const rejected = [first, retry].find((result) => result.status !== 200);
check("exactly one concurrent referred registration succeeds",
  [first, retry].filter((result) => result.status === 200).length === 1,
  `${first.status}/${retry.status}`);
check("successful referral reports the granted reward",
  successful?.json?.referralFeedback === "reward_granted",
  JSON.stringify(successful?.json));
check("the friend receives exactly one pass", successful?.json?.user?.linePassCount === 1);
check("the registration retry is rejected without another reward",
  rejected?.status === 401 || rejected?.status === 409,
  JSON.stringify(rejected?.json));
if (successful?.json?.user?.id) ids.push(successful.json.user.id);

const rewardState = await pool.query(
  `SELECT
     (SELECT line_pass_count FROM users WHERE id = $1) AS inviter_passes,
     (SELECT line_pass_count FROM users WHERE id = $2) AS friend_passes,
     (SELECT count(*)::int FROM referral_rewards WHERE friend_user_id = $2) AS rewards`,
  [inviterId, successful?.json?.user?.id],
);
check("inviter receives exactly one pass", rewardState.rows[0]?.inviter_passes === 1);
check("friend pass and attribution are recorded once",
  rewardState.rows[0]?.friend_passes === 1 && rewardState.rows[0]?.rewards === 1,
  JSON.stringify(rewardState.rows[0]));

const invalidGrant = await registrationGrant(invalidPhone);
const invalid = await req("/auth/complete-registration", {
  method: "POST",
  body: {
    registrationGrant: invalidGrant,
    firstName: "Invalid",
    lastName: "Referral",
    email: `invalid-${suffix}@example.test`,
    referralCode: "NOT-A-REAL-CODE",
  },
});
check("invalid code creates the account without granting a pass",
  invalid.status === 200
    && invalid.json?.referralFeedback === "invalid_code"
    && invalid.json?.user?.linePassCount === 0,
  JSON.stringify(invalid.json));
if (invalid.json?.user?.id) ids.push(invalid.json.user.id);
const ineligibleReferralInfo = await req("/referral", { token: invalid.json?.token });
check("non-members cannot distribute an ineligible referral link",
  ineligibleReferralInfo.status === 403
    && ineligibleReferralInfo.json?.code === "MEMBERSHIP_REQUIRED"
    && !ineligibleReferralInfo.json?.referralUrl,
  JSON.stringify(ineligibleReferralInfo.json));

const ownCode = await req("/auth/request-code", { method: "POST", body: { phone: inviterPhone } });
const self = await req("/auth/verify-code", {
  method: "POST",
  body: { phone: inviterPhone, code: ownCode.json?.demoCode, referralCode: inviterCode },
});
check("self-referral is rejected with understandable feedback",
  self.status === 200 && self.json?.referralFeedback === "self_referral",
  JSON.stringify(self.json));
const referralInfo = await req("/referral", { token: self.json?.token });
check("member has a canonical member-specific referral URL",
  referralInfo.status === 200
    && referralInfo.json?.referralUrl === `https://bluebird.co/join/${inviterCode}`
    && referralInfo.json?.rewardPassesPerPerson === 1,
  JSON.stringify(referralInfo.json));

const friendCode = await req("/auth/request-code", { method: "POST", body: { phone: friendPhone } });
const reused = await req("/auth/verify-code", {
  method: "POST",
  body: { phone: friendPhone, code: friendCode.json?.demoCode, referralCode: secondInviterCode },
});
check("an existing referred account cannot earn another reward",
  reused.status === 200 && reused.json?.referralFeedback === "already_used",
  JSON.stringify(reused.json));
const finalState = await pool.query(
  `SELECT
     (SELECT line_pass_count FROM users WHERE id = $1) AS first_inviter,
     (SELECT line_pass_count FROM users WHERE id = $2) AS second_inviter,
     (SELECT count(*)::int FROM referral_rewards WHERE friend_user_id = $3) AS rewards`,
  [inviterId, secondInviterId, successful?.json?.user?.id],
);
check("retry, self-referral, and reuse do not duplicate referral rewards",
  finalState.rows[0]?.second_inviter === 0
    && finalState.rows[0]?.rewards === 1,
  JSON.stringify(finalState.rows[0]));

await pool.query(`DELETE FROM trip_passengers WHERE trip_id IN (SELECT id FROM trips WHERE user_id = ANY($1::text[]))`, [ids]);
await pool.query(`DELETE FROM manifest_operational_updates WHERE trip_id IN (SELECT id FROM trips WHERE user_id = ANY($1::text[]))`, [ids]);
await pool.query(`DELETE FROM queue_entries WHERE user_id = ANY($1::text[])`, [ids]);
await pool.query(`DELETE FROM trips WHERE user_id = ANY($1::text[])`, [ids]);
await pool.query(`DELETE FROM notifications WHERE user_id = ANY($1::text[])`, [ids]);
await pool.query(`DELETE FROM referral_rewards WHERE inviter_user_id = ANY($1::text[]) OR friend_user_id = ANY($1::text[])`, [ids]);
await pool.query(`DELETE FROM login_codes WHERE phone = ANY($1::text[])`, [phones]);
await pool.query(`DELETE FROM registration_grants WHERE phone = ANY($1::text[])`, [phones]);
await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [ids]);
await pool.end();

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);