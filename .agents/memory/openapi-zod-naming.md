---
name: OpenAPI schema naming vs zod codegen
description: Schema names must not collide with generated <OperationId>Response names
---
Rule: never name a component schema `<OperationId>Response` (e.g. schema `CancelTripResponse` with operationId `cancelTrip`). The zod generator emits an operation-level export with exactly that name, and the api-zod barrel re-exports both, breaking typecheck with a duplicate-export error.

**Why:** Codegen failed with TS2308 when a new schema's name matched the operation's generated response name.

**How to apply:** When adding endpoints to openapi.yaml, pick schema names that differ from `<OperationId>Response`/`<OperationId>Params` (e.g. `CancelBookingResponse` for operation `cancelTrip`).
