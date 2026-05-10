# noorm Design System

A design system for **noorm** — a CLI for SQL-first database development.
Tagline: *Write SQL files, deploy them to any environment. Skip the ORM.*

This system is being built fresh. The current marketing/docs site at
[noorm.dev](https://noorm.dev) is a stock VitePress install — it is **not**
the visual reference. The goal of this project is to define the new look
the user will roll out across the docs site, marketing pages, and CLI/TUI.

---

## Sources

- **Live site (existing, do NOT mimic):** https://noorm.dev (VitePress v2 alpha)
- **GitHub:** https://github.com/noormdev/noorm
- **npm:** `@noormdev/cli`
- **Color seed:** `assets/source-palette.png` — four hexes from a palette generator:
  `#212931` ink · `#454A59` slate · `#916336` bronze · `#E05742` ember.
- **Product copy reference:** the homepage at noorm.dev (mirrored mentally;
  see `CONTENT FUNDAMENTALS` for distilled tone notes).

The user does **not** have access to a Figma file or a private codebase here.
The repo is public on GitHub but was not imported in this session — when in
doubt, prefer the rules in this doc over speculation about the live product.

---

## What noorm is, in one paragraph

noorm is a single CLI binary (also a TUI launched via `noorm ui`) that runs
against your real database. You keep your schema as a folder of `.sql` files —
the canonical "what should exist today." You keep an ordered folder of
`changes/` — the "how to migrate any existing DB to today." `noorm run build`
applies the schema; `noorm change ff` fast-forwards an existing database. It
is opinionated about real relational design (inherited keys, basetype-subtype
patterns) and aggressively un-opinionated about which database you use.

The brand has to feel like that: **opinionated, technical, warm, lived-in.**
Closer to a well-loved Unix tool than a startup landing page.

---

## Index — what's in this folder

```
README.md                    ← you are here
SKILL.md                     ← agent skill manifest (see bottom)
colors_and_type.css          ← all design tokens; import this, don't redefine

assets/
  noorm-logo.svg               wordmark
  noorm-mark.svg               square mark
  noorm-mark-dark.svg          square mark, light-on-dark variant
  source-palette.png           the original palette screenshot
  icons/                       Lucide icons saved locally (see ICONOGRAPHY)

preview/                     ← Design System tab cards (~700×Xpx each)
  brand-*.html                 logo, wordmark, the mark in use
  color-*.html                 palettes, semantic tokens, dark mode
  type-*.html                  typeface specimens, scale, code/CLI usage
  spacing-*.html               radii, spacing, shadow, motion
  component-*.html             buttons, inputs, cards, callouts, etc.

ui_kits/
  docs-site/                   The new noorm docs / marketing site
    index.html                   click-thru of homepage → docs page
    *.jsx                        components (Header, Hero, FeatureGrid, …)
    README.md
  cli-tui/                     The noorm TUI rendered in HTML
    index.html                   simulated terminal session
    *.jsx                        components (TerminalFrame, Prompt, MenuRow, …)
    README.md
```

---

## CONTENT FUNDAMENTALS

How noorm talks. Apply to docs, marketing, error messages, and CLI output.

**Voice:** A senior engineer who has shipped a lot of databases and is tired
of bad ORMs. Direct, technical, mildly cocky but never snarky-for-fun. The
copy stops short of being a manifesto — it just keeps proving its point with
SQL.

**Person:**
- We use **second person ("you")** for instructions: *"You write whatever SQL
  your database supports."*
- **First person plural ("we")** is rare — the brand is a tool, not a team.
  Avoid "we built this for you."
- **First person singular ("I")** appears once, intentionally, as a wink:
  the homepage line *"Try working that into your ORM. I'll wait..."* That's
  the only place a human voice peeks through. Don't overuse it.

**Casing:**
- Headings: **sentence case.** "Current schema, always." Not "Current Schema, Always."
- Product name: **always lowercase `noorm`**, even at the start of a sentence.
- CLI commands and file paths in `monospace`, lowercase.
- Acronyms (SQL, CLI, TUI, SDK, ORM, ID, NULL) stay uppercase.

**Punctuation & rhythm:**
- Short declarative sentences. Sentence fragments are fine: *"Skip the ORM."*
- Em-dashes welcome, sparingly. Oxford commas yes.
- Bullet lists are encouraged for feature breakdowns. **Bold the noun**, then
  one short clause:
  - **SQL files** define your current schema
  - **Changes** move existing databases from any state to current
- Code blocks should be runnable as-is. Prefer real commands over pseudocode.

**Emoji & decorative chars:** **No.** Not in marketing, not in docs, not in
CLI output. The aesthetic is iron and terracotta, not party emoji. Unicode
box-drawing chars (`├─`, `│`, `└─`) for tree output and ASCII arrows (`→`,
`←`) are welcome — they read as terminal-native.

**Confidence & opinion:**
- The brand is willing to argue. *"You pay for bad relational design later."*
  Keep that energy in marketing copy.
- Never apologetic in error messages. Tell the user what happened and what
  to do next, in that order. No "Oops!"

**Examples to copy from:**

> **Why noorm?**
> noorm is a command-line tool for SQL-first database development. You write
> compound keys, check constraints, triggers, stored procedures. noorm
> executes them, tracks what ran, and keeps environments in sync.

> **SQL files = current schema. Changes = how to get existing databases there.**

> *Try working that into your ORM. I'll wait...*

When in doubt, write it the way `man` pages and the Postgres docs are
written — assume a competent reader and respect their time.

---

## VISUAL FOUNDATIONS

### Color

- **Palette:** four seed hexes (ink `#212931`, slate `#454A59`, bronze
  `#916336`, ember `#E05742`) extended into 6-step neutral and 5-step warm
  scales in `colors_and_type.css`. **Don't sample new colors** — use the
  ones in the file or composite via `color-mix(in oklab, …)`.
- **Light mode is warm paper.** Background is `#F7F4EE` (off-white with a
  hint of bronze), not `#FFFFFF`. Pure white is a *raised surface* in this
  system.
- **Dark mode is warm ink.** `#161A20` background, with cream `#F2ECE0`
  text. Avoid pure black and pure white in dark mode — both feel sterile
  next to bronze and ember.
- **Ember is signal, not decoration.** Use it for the primary CTA, the
  cursor, the active link, errors. Two embers per screen, max.
- **Bronze is for editorial moments** — pull-quotes, eyebrow lines, link
  underlines, the wordmark accent. Bronze is the brand's "tasteful"
  register; ember is the loud one.
- **Status colors** derive from the seed family: ok is mossy green, warn is
  lifted bronze, info is dusty slate-blue, error is ember itself.

### Typography

- **Display + body: Geist** (Google Fonts).
- **Code, CLI, eyebrows, captions, kbd, file paths: Geist Mono.** We use
  mono more than most brands — it's part of the voice.
- **No serif.** Tempting, but it would dilute the tool-shaped feel.
- **Sentence case** for all headings. Tight letter-spacing on display sizes
  (`-0.02em`), normal everywhere else.
- **Line length:** body copy capped at `--max-w-prose` (~68ch). Don't run
  paragraphs the full width of a wide layout — break with subheads or pull
  the content into a narrower column.
- **Substitution note:** the user has not provided a custom typeface. Geist
  is loaded from Google Fonts as the closest free match for the technical-
  but-warm character we want. **Flag for the user:** if you want a
  proprietary face later, swap `--font-sans` and `--font-mono` in
  `colors_and_type.css`.

### Spacing & layout

- **4px base grid.** Tokens `--space-1` (4) through `--space-24` (96).
- **Generous vertical rhythm in marketing**, dense vertical rhythm in docs
  and the TUI. Marketing sections run `--space-20` apart; docs paragraphs
  run `--space-4`.
- **Centered, capped content.** `--max-w-content` is 72rem (1152px); wide
  sections cap at 84rem. Never stretch text edge-to-edge.
- **Asymmetric layouts are encouraged.** Two-column with a 7/5 split, an
  eyebrow line offset to the left, a code block hanging into the gutter —
  this brand is comfortable being a little un-grid.

### Backgrounds

- **No full-bleed photography. No hero illustrations. No mesh gradients.**
- The primary background texture is **warm paper** (light) or **warm ink**
  (dark). On big surfaces, allow a *very* subtle 1–2% noise overlay to
  break flatness — optional, never required.
- **Code blocks** are the brand's signature visual: a slightly sunken
  `--code-bg` block with a 1px border, mono type, no syntax-highlighter
  rainbow (we limit highlight colors to fg-1, fg-3, ember, bronze).
- **Section dividers** are a single `--border` hairline. No fancy SVG dividers.

### Borders & corners

- **Hairlines, not heavy borders.** 1px, `--border` color. Always. The only
  time we use a 2px border is the **focus ring** (color `--border-focus` /
  ember).
- **Radii are restrained:**
  - 4px for code, kbd, tags
  - 6px for inputs, buttons, the default
  - 10px for cards
  - 14px for hero cards / large feature blocks
  - 20px+ exists but is rare; pill `999px` for compact filter chips only.
- **Never a "rounded-2xl candy card" look.** A noorm card looks like a
  document, not a button.

### Shadow system

- Light mode: gentle warm-tinged drop shadows (`--shadow-sm` for raised UI,
  `--shadow-md` for popovers, `--shadow-lg` for modals only). Always paired
  with a hairline border — shadow alone is not enough lift.
- Dark mode: shadows are mostly **rim lights** (`inset 0 1px 0 rgba(255,
  255, 255, 0.03)`) plus a soft drop. We don't fake elevation with heavy
  black shadows in dark mode; we use border + tone-step instead.
- **No glow effects.** No neon. No drop-shadow on text. Ever.

### Motion

- **Fast and decisive.** Default duration `--dur-base` is 180ms.
- **Easing:** `--ease-out` for entrances, `--ease-in-out` for transforms,
  `--ease-snap` for everything else. **No bounces.** No springs. No elastic.
- **Allowed primitives:** opacity fade, 4–8px translate-y, 1px border-color
  swap, color fade. That's it.
- **Reduced motion:** all animations collapse to opacity-only fades when
  `prefers-reduced-motion`.

### Hover & press states

- **Hover, buttons:** background steps one color darker (`--accent-hover`),
  no scale change. 120ms.
- **Hover, links:** color shifts from `--link` (bronze) to `--link-hover`
  (ember); underline goes from 1px solid to 2px solid. Don't animate
  underline thickness — swap it.
- **Hover, cards:** border goes from `--border` to `--border-strong`;
  shadow steps one level. No translate, no scale.
- **Press:** background steps to `--accent-press`, button content shifts
  down by 1px (no scale). Ends in 80ms.
- **Disabled:** 40% opacity, `cursor: not-allowed`. No re-coloring.

### Transparency & blur

- **Blur is rare.** Used for the docs site's **sticky header** when the
  page has scrolled (8px backdrop-blur + 70% opacity bg). Nowhere else by
  default.
- **Translucency is rare.** Selection highlights and accent-soft tints are
  built with `color-mix`, not RGBA opacity, so they read correctly on warm
  paper.

### Imagery

- **No photography in v1.** If imagery becomes necessary, the direction is
  warm, low-contrast, slightly desaturated; never cold corporate stock; no
  people unless absolutely necessary; grain is welcome.
- **Diagrams over screenshots.** When showing how data flows or how a
  schema is laid out, use ASCII tree blocks (see the homepage's todo-list
  example) before reaching for an SVG diagram. ASCII trees in mono type
  *are* the hero illustration.

---

## ICONOGRAPHY

- **Source:** [Lucide](https://lucide.dev) (ISC license). Outline-style,
  1.5px stroke, square caps, 24×24 viewBox. Sits naturally with Geist's
  geometric forms.
- **Substitution flagged:** the live noorm.dev currently uses solid Font
  Awesome glyphs (`fast-forward.svg`, `database.svg`, `toolbox.svg`,
  `cubes.svg`). The new system replaces these with Lucide outline
  equivalents:
  - `fast-forward.svg` → Lucide `fast-forward`
  - `database.svg`     → Lucide `database`
  - `toolbox.svg`      → Lucide `wrench` or `package`
  - `cubes.svg`        → Lucide `boxes`
- **A small set is saved locally** under `assets/icons/` so the design
  system works offline. Anything else: pull from the Lucide CDN
  (`https://unpkg.com/lucide-static@latest/icons/<name>.svg`).
- **Stroke-style only.** Don't mix solid and outline icons in the same
  layout.
- **Sizes:** 16px (inline with body text), 20px (default UI), 24px (feature
  blocks), 32–40px (hero / empty-state).
- **Color:** icons inherit `currentColor`. Use `--fg-2` by default; `--fg-1`
  when an icon is the focal element of a tile; `--accent` only when the
  icon is acting as a status indicator.
- **Emoji:** **never.** No exceptions.
- **Unicode glyphs:** allowed and encouraged for **terminal/CLI contexts
  only** — `→`, `←`, `↑`, `↓`, `✓`, `✗`, box-drawing chars `├─ │ └─`. In
  marketing UI, use Lucide instead.

---

## SKILL.md

A `SKILL.md` lives at the root of this folder so the system can be loaded
into Claude Code or invoked as a Claude skill. Open that file for the
agent-facing summary.
