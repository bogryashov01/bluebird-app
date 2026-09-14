---
name: API contract & schema sync
description: How backend changes must propagate in this project to survive review
---
Rule: any new endpoint or request field must be added to `lib/api-spec/openapi.yaml` and regenerated via `pnpm run codegen` (React client + Zod validators) — never hand-edit generated files. Any new DB column must be added in both the drizzle schema AND `lib/db/src/migrate.ts` (`ensureSchema()` CREATE TABLE + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`); running ALTER only against the live DB is not deployable.

**Why:** Task completion reviews rejected work twice because generated clients were hand-edited and a column existed only in the live DB, so fresh databases and validators disagreed with the server.

**How to apply:** Whenever the sidekick touches api-server routes or the DB schema, require spec + codegen + ensureSchema updates and fresh-schema verification in the task brief.
