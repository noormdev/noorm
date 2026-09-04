---
"@noormdev/cli": minor
---

Make `run inspect` scrollable, and show secrets partially rather than as a count.

The inspect screen rendered its context as a nested tree that grew with the
project, and Ink has no scroll offset — so on any real template the bottom of
the view sat below the fold with no key that could reach it, and the screen's
own footer was what got pushed off to make room. Every view it offers (summary,
expanded, rendered SQL, and render errors) is now a flat list of one element per
visual line behind a viewport, scrolled with the same `↑↓` / `^U` / `^D` keys the
explore and SQL screens already use.

`$.secrets` and `$.globalSecrets` reported a key count, which cannot answer the
question the screen is opened to answer: a stale password and a fresh one are
both `Object (7 keys)`. Both tiers now show a partial reveal that narrows as the
value gets shorter — a four-character value shows nothing, a long one shows two
characters and a four-character suffix — with the length beside it as a number,
so a value that is set but empty is distinguishable from one that is set wrong.
`$.env` is listed and masked on the same terms, because it is the whole of
`process.env` and nothing in the screen can tell which of its keys are
credentials.

The mouse wheel now scrolls every viewport, which it never did. Only `SelectList`
and `ResultTable` consumed wheel notches, so the explore detail view, the
full-text overlay and the row viewer ignored them — and because the TUI runs in
the alternate screen, which has no scrollback, and mouse tracking intercepts the
notches a terminal would otherwise translate into arrow keys, turning the mouse
on had actually removed the only wheel behaviour those panes had.

Also fixes an error path that could never render: a template whose helper failed
to load set the screen's error phase with a file selected, which no branch
matched, so the most likely failure showed as "Unknown phase".
