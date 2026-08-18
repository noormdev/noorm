---
paths:
  - "docs/**/*.md"
---

# Documentation rules


## Voice is assigned per file, not globally

The `## Documentation surfaces` table in the root `CLAUDE.md` assigns every doc path a voice: `atomic-writing` or `terse-technical`. That table is the authority, and `/documentation` reads it to route authoring. Look the file up there before writing, and follow the `atomic-writing` skill when it says so.

Do not impose one house tone across `docs/`. A CLI reference and a getting-started guide are labeled differently on purpose.


## Claims

Every claim has to be one you can point at.

Do not invent a position to argue against. No "some people say", no "you may have been told", no opponent who does not hold the view. State the finding and let it stand without a foil.

`docs/guide/changes/overview.md:15` currently breaks this ("Some argue that you *are* moving data..."). Fix it when you next touch that file, and do not copy the shape.

Measurements carry their conditions: the tool, the scale, the run. Never combine numbers from different runs or builds into one comparison. If the conditions differ, re-measure or say which figure came from where.

Mark inference as inference. An extrapolation from a mechanism reads as a measured result unless the text says otherwise.


## Structure

Lead with the problem the reader wants to solve, then the mechanism. Code follows the explanation that motivates it.

Prefer a table, tree, or diagram wherever the content has a shape. Reserve prose for reasoning and motivation, which is the one thing a table cannot carry.
