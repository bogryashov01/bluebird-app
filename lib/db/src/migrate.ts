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
      email           TEXT        NOT NULL UNIQUE,
      password_hash   TEXT        NOT NULL,
      membership_tier TEXT        NOT NULL DEFAULT 'base',
      email_verified  BOOLEAN     NOT NULL DEFAULT false,
      line_pass_count INTEGER     NOT NULL DEFAULT 0,
      referral_code   TEXT        NOT NULL,
      referred_by     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

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
      status           TEXT        NOT NULL DEFAULT 'available',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE flights ADD COLUMN IF NOT EXISTS price_usd    INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS discount_pct INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS featured     BOOLEAN NOT NULL DEFAULT false;

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

    CREATE TABLE IF NOT EXISTS trips (
      id         TEXT        PRIMARY KEY,
      user_id    TEXT        NOT NULL REFERENCES users(id),
      flight_id  TEXT        NOT NULL REFERENCES flights(id),
      status     TEXT        NOT NULL DEFAULT 'upcoming',
      booked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
