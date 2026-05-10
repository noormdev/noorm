# noorm Docs Site — UI Kit

Pixel-styled recreation of the **new** noorm marketing + docs site, built on
the design system tokens in `../../colors_and_type.css`.

This is the kit the new `noorm.dev` will be built from. It is **not** a copy
of the current VitePress install — that site is a stock template; this kit
is the rebrand.

## Files

- `index.html` — interactive click-thru. Lands on the home page. Click
  *Docs* in the header to navigate to the docs view. Theme toggle (sun/moon)
  flips light/dark.
- `Header.jsx` — sticky top bar with logo, nav, search trigger, theme
  toggle, GitHub link.
- `Hero.jsx` — display headline, lead, primary + secondary CTA, embedded
  terminal demo.
- `FeatureGrid.jsx` — four-tile feature grid (icon + h4 + body).
- `CodeBlock.jsx` — terminal-styled code block with header (lang + filename)
  and copy affordance. Reused inside Hero.
- `DocsPage.jsx` — sidebar + main column docs layout, with TOC on the right.
- `Footer.jsx` — minimal three-column footer (links + license + GitHub).
- `App.jsx` — top-level click-thru that renders Home or Docs, owns the
  theme.

## Components covered

Header (logo · nav · search · theme · github), Hero (display + lead + CTA
group + embedded code), FeatureGrid (icon tiles), CodeBlock (terminal),
DocsPage (sidebar nav + article + right TOC + prev/next), Callout (inline
in DocsPage), Footer.

## Not covered (intentionally)

- Search modal — referenced by the trigger but not built out.
- Blog / changelog — not part of the immediate noorm.dev surface.
- Long-form interactive playground — out of scope for the kit.

## How to extend

Tokens live in `../../colors_and_type.css`. Add new components by:
1. Reference `var(--*)` tokens, never hex literals.
2. Sentence-case all headings.
3. Mono for eyebrows, captions, kbd, version tags, file paths.
4. Two embers per screen, max — pick CTA *or* status, not both.
