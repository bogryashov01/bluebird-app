---
name: Family pass cycles
description: Annual Family pass usage must remain tied to the cycle in which it was redeemed.
---

Family pass redemptions need a cycle marker on the booking. Renewal resets the member ledger, so cancellation must refund only when the booking cycle matches the current plan cycle; otherwise an old booking can restore an expired pass.

**Why:** Annual renewal intentionally expires unused and previously consumed Family passes while preserving the allocation shape. A later cancellation must not corrupt the new year's pool.

**How to apply:** When adding Family pass redemption or refund paths, update the ledger and booking cycle atomically and keep personal passes in a separate balance.