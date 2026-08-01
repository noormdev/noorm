---
title: Branding your model
description: Put your own logo, title, and copyright on an ignatius model. The default chrome is a placeholder, not a claim on your work.
---

# Branding your model


An ignatius model is yours. The entities, the prose, the flows, and the diagrams generated from them are your work product, and nothing about using the tool changes that.

Out of the box the app wears noorm's chrome: a noorm logo, the title "Noorm Ignatius", the subtitle "Visualize your data model", and a footer reading "© 2026 Noorm Ignatius, powered by Noorm" with the year taken from the current date. That is placeholder branding on a viewer you are expected to replace, not a claim on the model it displays. The copyright line exists so you have somewhere to put **your** organization, which is the point of it being configurable at all.

Replace all of it in `ignatius.yml`.


## The branding block


Every field is optional and falls back to the default.

```yaml
name: My Schema
branding:
    logo:
        dark: ./assets/logo-dark.svg
        light: ./assets/logo-light.svg
    title: Acme Corp Data Model
    subtitle: Internal, revision 4
    copyright:
        holder: Acme Corp
        year: 2026
    poweredBy: false
```

| Field | Default | Notes |
|---|---|---|
| `logo` | embedded noorm logo | One path applies to both modes, or use `{ dark, light }` for per-mode logos |
| `title` | `Noorm Ignatius` | Max 50 characters |
| `subtitle` | `Visualize your data model` | Max 50 characters |
| `copyright` | `{ holder: 'Noorm Ignatius', year: <current year> }` | Set `holder` to your organization |
| `poweredBy` | `true` | Set `false` to drop the footer attribution |

Setting `copyright.holder` and `poweredBy: false` removes every mention of noorm from the rendered model. Nothing asks you to keep the attribution, and no feature is gated behind it.

Logo paths resolve relative to the model root and are inlined as data URIs when you `export`, so a branded model stays a single self-contained HTML file with no external requests.


## Why this matters at export time


`ignatius export` produces one HTML file you hand to somebody: a stakeholder approving the design, a client receiving a deliverable, an auditor reading a system description. That file is the artifact your organization's name belongs on.

```bash
ignatius export ./models -o acme-data-model.html
```

Brand the model before that hand-off rather than after. It costs six lines of YAML and it is the difference between a document that reads as yours and one that reads as a tool's output.


## Colors and spacing


A `theme` block sets separate `dark` and `light` palettes plus layout spacing. It is deep-merged over the defaults, so set only what you want to change.

```yaml
theme:
    dark:
        background: "#0e1116"
        surface: "#161b22"
        text: "#e6edf3"
    light:
        background: "#ffffff"
        surface: "#f6f8fa"
        text: "#1f2328"
    spacing:
        nodeSep: 60
```

The viewer's light/dark toggle persists across reloads, and `export` takes `--theme light` or `--theme dark` to pick the starting palette.


### Data flow store colors


In a [data flow diagram](/modeling/data-flows) each store is colored by its kind. The defaults give every kind a distinct, mode-appropriate color: `cache` amber, `queue` violet, `file` lime, `doc` sky, `manual` rose, `other` slate, while `db` keeps the entity-store fill and `external` keeps the conventional green.

Override any of them under `theme.flowKinds`. Each kind takes `dark` and `light` entries of `{ bg, fg, border }`, deep-merged like the rest of the theme.

```yaml
theme:
    flowKinds:
        cache:
            dark:
                bg: "#3a2a00"
            light:
                bg: "#fff3c4"
        file:
            dark:
                bg: "#16270a"
```

Worth restraint here. The kind colors are a legend readers learn once, and a palette tuned for your brand rather than for distinguishability makes a busy diagram harder to read. Change them to fit your house style, not to make every store the same shade of corporate blue.


## Related


- [Entities and key inheritance](/modeling/entities#the-folder-format) for the rest of `ignatius.yml`
- [Best practices](/modeling/best-practices#review-before-you-build) for the review hand-off this feeds
- The [themes and branding guide](https://github.com/noormdev/ignatius/blob/main/docs/guides/themes-and-branding.md) in the ignatius repo
