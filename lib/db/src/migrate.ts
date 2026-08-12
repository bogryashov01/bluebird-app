import { pool } from "./index";

/**
 * Creates all application tables using CREATE TABLE IF NOT EXISTS.
 * Safe to call on every startup — no-ops when tables already exist.
 * This replaces the need for a separate drizzle-kit push step.
 */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT        PRIMARY KEY,
      name            TEXT        NOT NULL,
      phone           TEXT        NOT NULL UNIQUE,
      email           TEXT,
      membership_tier TEXT        NOT NULL DEFAULT 'base',
      line_pass_count INTEGER     NOT NULL DEFAULT 0,
      referral_code   TEXT        NOT NULL,
      referred_by     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_tier TEXT;

    -- Phone + SMS PIN auth migration: drop password/email-verification
    -- columns outright (demo — password access is intentionally removed),
    -- make email optional, and enforce phone as the unique identifier.
    ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
    ALTER TABLE users DROP COLUMN IF EXISTS email_verified;
    ALTER TABLE users DROP COLUMN IF EXISTS verification_token_hash;
    ALTER TABLE users DROP COLUMN IF EXISTS verification_token_expires;
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
    -- Drop ANY unique constraint/index on users.email regardless of the name
    -- it was created under (users_email_unique, users_email_key, ...).
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT c.conname FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'users' AND c.contype = 'u'
          AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
          AND (SELECT array_agg(a.attname) FROM unnest(c.conkey) k
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['email']::name[]
      LOOP
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
      END LOOP;
      FOR r IN
        SELECT i.relname FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        WHERE t.relname = 'users' AND ix.indisunique AND NOT ix.indisprimary
          AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
          AND ix.indexrelid NOT IN (SELECT conindid FROM pg_constraint)
          AND (SELECT array_agg(a.attname) FROM unnest(ix.indkey::int2[]) k
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k) = ARRAY['email']::name[]
      LOOP
        EXECUTE format('DROP INDEX %I', r.relname);
      END LOOP;
    END $$;

    -- Normalize legacy phone values to E.164 (same rules as the API):
    -- 10 digits -> +1XXXXXXXXXX, 11-15 digits -> +digits, otherwise NULL so
    -- the placeholder backfill below assigns a unique value.
    UPDATE users SET phone = (
      CASE
        WHEN length(regexp_replace(phone, '\\D', '', 'g')) = 10
          THEN '+1' || regexp_replace(phone, '\\D', '', 'g')
        WHEN length(regexp_replace(phone, '\\D', '', 'g')) BETWEEN 11 AND 15
          THEN '+' || regexp_replace(phone, '\\D', '', 'g')
        ELSE NULL
      END)
      WHERE phone IS NOT NULL AND phone !~ '^\\+[0-9]{11,15}$';

    -- Deduplicate: keep the phone on the oldest row; later duplicates fall
    -- back to the placeholder backfill.
    UPDATE users u SET phone = NULL
      FROM (
        SELECT id, row_number() OVER (PARTITION BY phone ORDER BY created_at, id) AS rn
        FROM users WHERE phone IS NOT NULL
      ) d
      WHERE u.id = d.id AND d.rn > 1;

    -- Backfill unique placeholder phones for rows without a usable number.
    UPDATE users u SET phone = '+1999' || lpad(ranked.rn::text, 7, '0')
      FROM (
        SELECT id, row_number() OVER (ORDER BY id) AS rn
        FROM users WHERE phone IS NULL OR phone = ''
      ) ranked
      WHERE u.id = ranked.id
        AND NOT EXISTS (
          SELECT 1 FROM users e WHERE e.phone = '+1999' || lpad(ranked.rn::text, 7, '0')
        );
    -- Extremely unlikely leftover collisions: assign from the row id instead.
    UPDATE users SET phone = '+1998' || lpad((abs(hashtext(id)) % 10000000)::text, 7, '0')
      WHERE phone IS NULL OR phone = '';
    ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone);

    CREATE TABLE IF NOT EXISTS login_codes (
      phone        TEXT        PRIMARY KEY,
      code_hash    TEXT        NOT NULL,
      expires_at   TIMESTAMPTZ NOT NULL,
      attempts     INTEGER     NOT NULL DEFAULT 0,
      last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS flights (
      id               TEXT        PRIMARY KEY,
      from_airport     TEXT        NOT NULL,
      from_city        TEXT        NOT NULL,
      to_airport       TEXT        NOT NULL,
      to_city          TEXT        NOT NULL,
      aircraft_type    TEXT        NOT NULL,
      aircraft_capacity INTEGER   NOT NULL,
      departure_date   TEXT        NOT NULL,
      departure_time   TEXT        NOT NULL,
      duration         TEXT        NOT NULL,
      seats_available  INTEGER     NOT NULL,
      price_usd        INTEGER     NOT NULL DEFAULT 0,
      discount_pct     INTEGER     NOT NULL DEFAULT 0,
      featured         BOOLEAN     NOT NULL DEFAULT false,
      international    BOOLEAN     NOT NULL DEFAULT false,
      international_fee_usd INTEGER NOT NULL DEFAULT 0,
      range_nm         INTEGER,
      cruise_speed     TEXT,
      dest_weather     TEXT,
      departure_fbo    TEXT,
      status           TEXT        NOT NULL DEFAULT 'available',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE flights ADD COLUMN IF NOT EXISTS price_usd    INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS discount_pct INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS featured     BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS international BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS international_fee_usd INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS range_nm      INTEGER;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS cruise_speed  TEXT;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS dest_weather  TEXT;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS departure_fbo TEXT;

    CREATE TABLE IF NOT EXISTS queue_entries (
      id             TEXT        PRIMARY KEY,
      user_id        TEXT        NOT NULL REFERENCES users(id),
      flight_id      TEXT        NOT NULL REFERENCES flights(id),
      position       INTEGER     NOT NULL,
      status         TEXT        NOT NULL DEFAULT 'waiting',
      used_line_pass BOOLEAN     NOT NULL DEFAULT false,
      passengers     INTEGER     NOT NULL DEFAULT 1,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS passengers INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS front_notified_at TIMESTAMPTZ;
    ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS intl_fee_accepted BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS trips (
      id         TEXT        PRIMARY KEY,
      user_id    TEXT        NOT NULL REFERENCES users(id),
      flight_id  TEXT        NOT NULL REFERENCES flights(id),
      status     TEXT        NOT NULL DEFAULT 'upcoming',
      booked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash TEXT        PRIMARY KEY,
      user_id    TEXT        NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS concierge_messages (
      id         TEXT        PRIMARY KEY,
      user_id    TEXT        NOT NULL REFERENCES users(id),
      role       TEXT        NOT NULL,
      content    TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT        PRIMARY KEY,
      user_id    TEXT        NOT NULL REFERENCES users(id),
      title      TEXT        NOT NULL,
      body       TEXT        NOT NULL,
      type       TEXT        NOT NULL DEFAULT 'system',
      read       BOOLEAN     NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
