---
name: Orval codegen post-patch
description: Generated react-query hook option types must stay Partial<> — codegen includes a patch step
---
The codegen command includes a post-generation patch that wraps hook `query` options in `Partial<UseQueryOptions>`.

**Why:** Orval v8 can't express this in config, and without it any caller passing only `enabled` fails typecheck.

**How to apply:** Regenerate the client only via the package's codegen script (never raw orval, never hand-edit generated output), and keep the patch step when changing codegen.
