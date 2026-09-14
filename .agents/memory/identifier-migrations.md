---
name: Identifier-column migrations
description: Rules for startup migrations that change a users/account identifier column (e.g. email → phone)
---

**Rule:** When a startup migration (ensureSchema) changes which column is the unique identifier:
1. Never drop a unique constraint by a hardcoded name — `TEXT UNIQUE` in the original CREATE produces PG's default `<table>_<col>_key`, not drizzle-style `<table>_<col>_unique`. Drop by catalog lookup (pg_constraint/pg_index on the column, scoped to `current_schema()`).
2. Before adding `NOT NULL` + a unique index on the new identifier, normalize existing values (same rules as the API), collapse duplicates (keep oldest row), and backfill guaranteed-unique placeholders for the rest.
3. Prove it with a fixture: recreate the *previous* schema plus messy legacy rows in a scratch PG schema, run the migration SQL twice (idempotency), and assert the result.

**Why:** A hardcoded `DROP CONSTRAINT <table>_<col>_unique` silently leaves the real default-named constraint in place, and un-normalized duplicate legacy values make the new `CREATE UNIQUE INDEX` fail at startup, taking the whole API down.

**How to apply:** Any migration that renames/moves the unique account identifier or relaxes a formerly-unique column.
