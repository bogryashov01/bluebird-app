---
name: Seed after migration
description: Fixture writers must follow the current canonical data model because startup restores fixtures after schema migrations.
---

Development fixture restoration occurs after schema migration. Seeded values cannot rely on a migration to promote legacy fields into new authoritative fields.

**Why:** A migration can only promote rows present when it runs. Any fixture written afterward with legacy fields can look valid in storage but fail readers that use the new canonical field.

**How to apply:** Whenever moving a field's authority between records, update development seed and restore flows as well as the migration. Verify a freshly restarted service and explicitly exercise any deterministic fixture route.