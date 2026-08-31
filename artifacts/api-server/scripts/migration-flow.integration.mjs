/**
 * Integration test for the users-table migration to phone-based auth.
 *
 * Recreates the PREVIOUS (email/password era) users schema in a scratch
 * PostgreSQL schema, seeds legacy rows — including formatted, duplicate,
 * NULL, and unusable phone values plus the default `users_email_key`
 * unique constraint — then executes the exact migration SQL that
 * `ensureSchema()` runs (extracted verbatim from lib/db/src/migrate.ts)
 * and asserts the result. Runs the migration TWICE to prove idempotency.
 *
 * Run:  pnpm run test:migration-flow   (needs DATABASE_URL)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = require("pg");

const SCHEMA = "migration_flow_test";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-csearch_path=${SCHEMA}`,
});

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failures++;
}

// Extract the single SQL template literal from ensureSchema() so the test
// exercises the very statements the server runs at startup.
const src = readFileSync(new URL("../../../lib/db/src/migrate.ts", import.meta.url), "utf8");
const match = src.match(/await pool\.query\(`([\s\S]*?)`\);/);
if (!match) { console.error("Could not extract migration SQL from migrate.ts"); process.exit(1); }
// Un-escape TS template-literal backslashes (`\\D` in source → `\D` in SQL).
const migrationSql = match[1].replace(/\\\\/g, "\\");

const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);

// ── Legacy (pre-phone-auth) users schema with realistic data ────────────────
await pool.query(`
  CREATE TABLE users (
    id              TEXT        PRIMARY KEY,
    name            TEXT        NOT NULL,
    email           TEXT        NOT NULL UNIQUE,      -- default users_email_key
    password_hash   TEXT        NOT NULL,
    email_verified  BOOLEAN     NOT NULL DEFAULT false,
    verification_token_hash TEXT,
    verification_token_expires TIMESTAMPTZ,
    phone           TEXT,
    membership_tier TEXT        NOT NULL DEFAULT 'base',
    pending_tier    TEXT,
    line_pass_count INTEGER     NOT NULL DEFAULT 0,
    referral_code   TEXT        NOT NULL,
    referred_by     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE users ADD COLUMN home_airport TEXT;
  INSERT INTO users (id, name, email, password_hash, phone, referral_code, home_airport, created_at) VALUES
    ('u1', 'Formatted Phone', 'a@test.local', 'x', '(555) 123-4567',  'AAAA1111', 'dal', NOW() - INTERVAL '5 days'),
    ('u2', 'Dup Phone Old',   'b@test.local', 'x', '+15551234567',    'BBBB2222', 'JFK', NOW() - INTERVAL '9 days'),
    ('u3', 'Dup Phone New',   'c@test.local', 'x', '555-123-4567',    'CCCC3333', NULL, NOW() - INTERVAL '1 day'),
    ('u4', 'No Phone',        'd@test.local', 'x', NULL,              'DDDD4444', '', NOW() - INTERVAL '3 days'),
    ('u5', 'Junk Phone',      'e@test.local', 'x', 'n/a',             'EEEE5555', 'invalid', NOW() - INTERVAL '2 days'),
    ('u6', 'Intl Phone',      'f@test.local', 'x', '+44 20 7946 0958','FFFF6666', 'TEB', NOW() - INTERVAL '4 days'),
    ('u7', 'Unknown Airport', 'g@test.local', 'x', NULL,              'GGGG7777', 'XYZ', NOW() - INTERVAL '6 days');
`);

// ── Run the real migration SQL twice (startup + restart idempotency) ────────
let firstRunOk = true, secondRunOk = true;
try { await pool.query(migrationSql); } catch (e) { firstRunOk = false; console.error(e.message); }
check("migration succeeds on a legacy database", firstRunOk);
try { await pool.query(migrationSql); } catch (e) { secondRunOk = false; console.error(e.message); }
check("migration is idempotent (second run clean)", secondRunOk);

// ── Assertions ───────────────────────────────────────────────────────────────
const cols = (await pool.query(`
  SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_schema = '${SCHEMA}' AND table_name = 'users'`)).rows;
const colNames = cols.map((c) => c.column_name);
check("password/verification columns dropped",
  !colNames.some((c) => ["password_hash", "email_verified", "verification_token_hash", "verification_token_expires"].includes(c)));
check("email is nullable", cols.find((c) => c.column_name === "email")?.is_nullable === "YES");
check("phone is NOT NULL", cols.find((c) => c.column_name === "phone")?.is_nullable === "NO");
check("home_airports is NOT NULL", cols.find((c) => c.column_name === "home_airports")?.is_nullable === "NO");

const emailUnique = (await pool.query(`
  SELECT count(*)::int AS n FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = '${SCHEMA}' AND t.relname = 'users' AND c.contype = 'u'
    AND (SELECT array_agg(a.attname) FROM unnest(c.conkey) k
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['email']::name[]`)).rows[0].n;
check("legacy users_email_key unique constraint removed", emailUnique === 0);

const dupEmail = await pool.query(`UPDATE users SET email = 'a@test.local' WHERE id = 'u4'`).then(() => true).catch(() => false);
check("duplicate emails now allowed", dupEmail);

const rows = (await pool.query(`SELECT id, phone FROM users ORDER BY id`)).rows;
const byId = Object.fromEntries(rows.map((r) => [r.id, r.phone]));
check("formatted US phone normalized to E.164", byId.u1 === "+15551234567" || byId.u1?.startsWith("+1999"),
  `got ${byId.u1}`);
check("oldest duplicate keeps the number", byId.u2 === "+15551234567" || byId.u1 === "+15551234567" || byId.u3 === "+15551234567");
const normalized = rows.filter((r) => r.phone === "+15551234567");
check("normalized duplicates collapsed to a single owner", normalized.length === 1,
  JSON.stringify(byId));
check("international phone normalized", byId.u6 === "+442079460958", `got ${byId.u6}`);
check("junk phone got a unique placeholder", /^\+199[89]\d{7}$/.test(byId.u5 ?? ""), `got ${byId.u5}`);
check("all phones populated", rows.every((r) => typeof r.phone === "string" && r.phone.length > 0));
check("all phones unique", new Set(rows.map((r) => r.phone)).size === rows.length, JSON.stringify(byId));

const preferences = (await pool.query(`SELECT id, home_airports FROM users ORDER BY id`)).rows;
const prefsById = Object.fromEntries(preferences.map((r) => [r.id, r.home_airports]));
check("legacy airport is normalized and backfilled as one item",
  JSON.stringify(prefsById.u1) === JSON.stringify(["DAL"]), JSON.stringify(prefsById.u1));
check("another legacy airport is retained", JSON.stringify(prefsById.u2) === JSON.stringify(["JFK"]));
check("blank, malformed, and unknown legacy airports remain empty",
  prefsById.u3.length === 0
    && prefsById.u4.length === 0
    && prefsById.u5.length === 0
    && prefsById.u7.length === 0);
check("second migration does not duplicate a backfilled airport",
  JSON.stringify(prefsById.u6) === JSON.stringify(["TEB"]), JSON.stringify(prefsById.u6));

await pool.query(`UPDATE users SET home_airports = ARRAY[]::TEXT[] WHERE id = 'u1'`);
let clearRestartOk = true;
try { await pool.query(migrationSql); } catch (e) { clearRestartOk = false; console.error(e.message); }
const clearedPrefs = (await pool.query(`SELECT home_airport, home_airports FROM users WHERE id = 'u1'`)).rows[0];
check("migration remains clean after a member clears all airport preferences", clearRestartOk);
check("cleared airport preferences stay empty after restart",
  clearedPrefs.home_airport === null && clearedPrefs.home_airports.length === 0,
  JSON.stringify(clearedPrefs));

const phoneIdx = (await pool.query(`
  SELECT count(*)::int AS n FROM pg_indexes
  WHERE schemaname = '${SCHEMA}' AND tablename = 'users' AND indexname = 'users_phone_unique'`)).rows[0].n;
check("unique phone index exists", phoneIdx === 1);

const loginCodes = (await pool.query(`
  SELECT count(*)::int AS n FROM information_schema.tables
  WHERE table_schema = '${SCHEMA}' AND table_name = 'login_codes'`)).rows[0].n;
check("login_codes table created", loginCodes === 1);
const registrationGrants = Number((await pool.query(`
  SELECT count(*)::int AS n FROM information_schema.tables
  WHERE table_schema = '${SCHEMA}' AND table_name = 'registration_grants'`)).rows[0].n);
check("registration_grants table created", registrationGrants === 1);

await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`);
await pool.end();
await admin.end();

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
