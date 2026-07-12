---
id: v1-21-31-hygiene-f2
title: Add release-engine paragraph to ignatius CLAUDE.md
created: "2026-07-12"
origin: |
    docs/spec/v1-21-31-hygiene.md, iter 1 implementer (CP-10)
kind: finding
severity: question
review_by: "2026-09-10"
status: open
file: /Users/alonso/projects/noorm/ignatius/CLAUDE.md
---

Ticket 31 (document release-engine split) asks for a matching paragraph in the ignatius repo's CLAUDE.md stating release-please as its engine and why it fits (conventional-commit-derived changelog, single-package manifest -- unlike monorepo's fixed-version group, which exists to keep two coupled packages in lockstep). Not applied during v1/21-31-hygiene because ignatius is a separate git repo (/Users/alonso/projects/noorm/ignatius) with no worktree isolation or review loop inside that branch's scope.

Verbatim paragraph to add to ignatius/CLAUDE.md:

"Ignatius releases via release-please (conventional-commit-derived changelog, single-package manifest) -- the right fit for a single-package repo, unlike monorepo's fixed-version group which exists specifically to keep two coupled packages in lockstep."
