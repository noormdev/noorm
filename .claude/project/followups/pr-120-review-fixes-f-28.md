---
id: pr-120-review-fixes-f-28
title: A later `mockReset` would undo the useConnection restore
created: "2026-11-09"
origin: |
    PR 120 review fixes, test-leak fix iteration 1 reviewer.
kind: finding
severity: nit
review_by: "2027-01-08"
status: open
file: tests/cli/hooks/useVaultSecretKeys.test.tsx
---

`tests/cli/hooks/useVaultSecretKeys.test.tsx`

`afterAll` restores the real implementation on the mock. A later file that calls `vi.resetAllMocks()` or `mockReset` on that mock would clear it again.

Origin: test-leak fix iteration 1 reviewer.
