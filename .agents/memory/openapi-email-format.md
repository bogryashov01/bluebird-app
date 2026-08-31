---
name: OpenAPI email format
description: Generator compatibility constraint for email schemas in this workspace
---

Do not add `format: email` to the OpenAPI contract while the generated Zod package resolves a Zod version without the top-level `email()` helper. Model the field as a string and retain strict email validation at the server boundary.

**Why:** The current Orval Zod generator emits a top-level `zod.email()` call for this format, while the workspace resolves a Zod API that does not provide it, breaking library typechecking immediately after code generation.

**How to apply:** For new or changed email request fields, use an OpenAPI string schema, validate format in the server route, regenerate through the standard codegen command, and revisit this constraint only after confirming generated output against the installed Zod version.