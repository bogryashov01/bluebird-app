---
name: Networking fixture isolation
description: Development networking fixtures need an isolated queue slot and must not mutate unrelated queue members.
---

Keep a deterministic networking test member on a demo flight that is not shared with unrelated waiting entries, and hold only that known fixture out of the normal queue simulator.

**Why:** the front-member endpoint selects the actual oldest position-one waiting row, so renumbering or deleting another account to make room would corrupt shared development data; normal simulation would otherwise confirm the fixture before a manual networking run finishes.

**How to apply:** when changing the fixture flight or simulator, preserve all non-fixture queue rows and keep ordinary members on the existing queue lifecycle.