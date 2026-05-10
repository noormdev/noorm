---
name: noorm-design
description: Use this skill to generate well-branded interfaces and assets for noorm, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference

- **Tokens:** `colors_and_type.css` — import this; never re-declare colors or fonts.
- **Logos:** `assets/noorm-logo.svg`, `assets/noorm-mark.svg`, plus `-dark` / `-light` variants.
- **Icons:** `assets/icons/*.svg` (Lucide outline, 1.5px stroke, 24 viewBox, currentColor).
- **UI kits:** `ui_kits/docs-site/` (marketing + docs), `ui_kits/cli-tui/` (terminal).
- **Preview cards:** `preview/` — every design-system specimen as a standalone HTML file.

## Hard rules

- Product name is always lowercase **`noorm`**.
- Sentence case for all headings.
- No emoji. Ever.
- Two embers per screen, max — primary signal, not decoration.
- Light mode bg is **warm paper** `#F7F4EE`, not white. White is a *raised surface*.
- Dark mode bg is **warm ink** `#161A20`, with cream `#F2ECE0` text.
- Lucide outline icons only. Never mix with solid icons.
- No bouncy/spring animations. 120–180 ms, ease-out / ease-in-out / ease-snap.
- Cards look like documents (10 px radius, hairline border), not buttons.
