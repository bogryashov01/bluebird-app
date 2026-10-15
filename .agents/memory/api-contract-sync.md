---
name: API contract & schema sync
description: How backend changes must propagate in this project to survive review
---
Rule: any new endpoint or request field must be added to `lib/api-spec/openapi.yaml` and regenerated via `pnpm run codegen` (React client + Zod validators) — never hand-edit generated files. Any new DB column must be added in both the drizzle schema AND `lib/db/src/migrate.ts` (`ensureSchema()` CREATE TABLE + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); running ALTER only against the live DB is not deployable.

**Why:** Task completion reviews rejected work twice because generated clients were hand-edited and a column existed only in the live DB, so fresh databases and validators disagreed with the server.

**How to apply:** Whenever the sidekick touches api-server routes or the DB schema, require spec + codegen + ensureSchema updates and fresh-schema verification in the task brief.

Post-merge setup must rely on API startup migrations rather than automatic Drizzle schema push.

**Why:** Schema push requested truncation of the populated users table during unattended setup, then returned a successful process status despite a TTY prompt error. Forcing it would risk data loss.

**How to apply:** Keep dependency installation non-interactive, allow adequate installation time, and let workflow reconciliation restart the API to run its explicit migrations. Never add forced schema push to merge setup.

Rule: the mobile profile contract accepts `weightLbs`, but server-side weight persistence is unverified. Do not describe weight edits as saved without confirming the API route and storage path.

**Why:** A mobile request type only proves client-side acceptance; it does not establish durable server persistence.

**How to apply:** When profile saving is in scope, inspect the server implementation before promising persistence or enabling an explicit save action.
