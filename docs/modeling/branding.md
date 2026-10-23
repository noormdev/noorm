---
title: Branding your model
description: Put your own logo, title, and copyright on an ignatius model. The default chrome is noorm's placeholder, so replace it before you export a file for someone else.
---

# Branding your model

Put your organization's logo, title, and copyright on the model, so the file you export carries your name.

```yaml
# models/acme/ignatius.yml
name: Acme Schema
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

```bash
ignatius export models/acme -o acme-data-model.html
```

```
Wrote export to acme-data-model.html
```

The model is your work product. Until you replace them, the app shows noorm's logo, the title "Noorm Ignatius", the subtitle "Visualize your data model", a footer `© <year> Noorm Ignatius`, and "powered by Noorm". The attribution is optional and gates no feature.


## What can I set?


Every field is optional and falls back to its default on its own.

| Field | Default | Notes |
|---|---|---|
| `logo` | embedded noorm logo | One path for both modes, or `{ dark, light }`. With one of the two, the other mode reuses it |
| `title` | `Noorm Ignatius` | At most 50 characters. The header cuts it with `…` past 200px, about 25 characters |
| `subtitle` | `Visualize your data model` | At most 50 characters. Cut past 240px, about 40 characters |
| `copyright` | `{ holder: 'Noorm Ignatius', year: <current year> }` | Set `holder` to your organization |
| `poweredBy` | `true` | `false` drops the footer attribution |

A logo path is relative to the model root and can be `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp`. A `data:` or `http(s)` URL passes through. Logos are inlined, so a branded export stays one self-contained file. An export's tab title is the `name:` value.

To remove every noorm mark, set `logo`, `title`, `copyright.holder`, and `poweredBy: false`.


## How do I change colors?


A `theme` block is deep-merged over the defaults, so set only what you change. The `dark` and `light` palettes take `background`, `surface`, `border`, `text`, `textMuted`, `edgeIdentifying`, `edgeReferential`, and `pastelMix`. `spacing.nodeSep` defaults to `60`. In a [data flow diagram](/modeling/data-flows), `theme.flowKinds` recolors a store kind (`cache`, `queue`, `file`, `doc`, `manual`, `other`, `db`) or `external` with `{ bg, fg, border }` per mode.

```yaml
# models/acme/ignatius.yml
theme:
    dark:
        background: "#0e1116"
    spacing:
        nodeSep: 60
    flowKinds:
        cache:
            dark:
                bg: "#3a2a00"
            light:
                bg: "#fff3c4"
```

`ignatius export --theme light` starts the file in the light palette.


## What bites


| Symptom | Cause | Fix |
|---|---|---|
| A command exits `1` with `branding.title exceeds 50 characters (actual length: 68)` and a stack trace | `title` or `subtitle` is over 50 characters | Shorten it |
| The noorm logo still shows | The file is missing or has another extension, so `logo` falls back without a message | Check the path from the model root and the extension |
| The title ends in `…` | The header cuts it at 200px | Shorten it to about 25 characters |


## Next


- [Entities and key inheritance](/modeling/entities): the rest of `ignatius.yml`
- [ignatius commands](/modeling/installation): `export` and its flags
- [Best practices](/modeling/best-practices): review the model before you hand it over
- [Themes and branding guide](https://github.com/noormdev/ignatius/blob/main/docs/guides/themes-and-branding.md): the reference in the ignatius repo
