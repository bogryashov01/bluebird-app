---
name: GitHub publish transport
description: GitHub OAuth connector access is available through the REST proxy, while local HTTPS git transport may still reject pushes; empty repositories need an initial Contents commit before Git Data API objects.
---

The authorized GitHub connector does not necessarily provide credentials to the local `git push` HTTPS transport. For an empty repository, GitHub's Git Data API also rejects blob creation until the repository has its first commit; initialize the target branch through the Contents API, then create the complete tree and commit through the authenticated REST proxy.

**Why:** The connector authorizes API requests but is not a local Git credential helper, and GitHub has no object database to accept Git Data API blobs before the first commit.

**How to apply:** Prefer a normal non-force `git push` when the environment has Git transport authentication. If it is rejected, use the authorized GitHub REST proxy without exposing credentials, and verify the final remote tree against the local tracked tree.