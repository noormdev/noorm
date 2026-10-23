---
title: Download
description: Install noorm and ignatius on macOS, Linux, or Windows, plus the agent skills and the SDK.
sidebar: false
aside: false
pageClass: page-download
prev: false
next: false
---

# Download

noorm builds and changes databases. ignatius models them before they exist. Each is one binary with no runtime to install.

<div class="dl-grid">
<div class="dl-tool">

## noorm

<p class="dl-what">CLI, terminal UI, and MCP server. Builds schemas from SQL files, applies changes, and manages configs, secrets, and data.</p>

::: code-group

```bash [macOS / Linux]
curl -fsSL https://noorm.dev/install.sh | sh
```

```bash [npm]
npm install -g @noormdev/cli
```

```powershell [Windows]
npm install -g @noormdev/cli
# or noorm-windows-x64.exe from the GitHub releases page
```

:::

<p class="dl-label">Agent skill</p>

```bash
npx skills add noormdev/noorm/skills
```

<p class="dl-label">SDK, for application code</p>

```bash
npm install @noormdev/sdk kysely pg
```

<p class="dl-small">Swap <code>pg</code> for <code>mysql2</code>, <code>better-sqlite3</code>, or <code>tedious tarn</code>. Verify with <code>noorm --version</code>; update with <code>noorm update</code>.</p>

</div>
<div class="dl-tool">

## ignatius

<p class="dl-what">Data modeler. Turns a folder of markdown into an IDEF1X entity diagram, a data dictionary, and data flow diagrams.</p>

::: code-group

```bash [macOS / Linux]
curl -fsSL https://noorm.dev/ignatius.sh | sh
```

```powershell [Windows]
# ignatius-windows-x64.exe from the GitHub releases page
```

```bash [From source]
git clone https://github.com/noormdev/ignatius
cd ignatius && bun install && bun run build:cli
```

:::

<p class="dl-label">Agent skill</p>

```bash
npx skills add https://github.com/noormdev/ignatius --skill ignatius-modeling
```

<p class="dl-label">Try it on a model</p>

```bash
ignatius serve path/to/model -o
```

<p class="dl-small">Verify with <code>ignatius version</code>; update with <code>ignatius update</code>. See <a href="/modeling/installation">ignatius commands</a> for serve, validate, export, and the rest.</p>

</div>
</div>

## Both at once

```bash
curl -fsSL https://noorm.dev/install.sh | sh && curl -fsSL https://noorm.dev/ignatius.sh | sh
```

## Install options

| Need | noorm | ignatius |
|---|---|---|
| Install somewhere else | `curl … \| NOORM_INSTALL_DIR=~/bin sh` | `curl … \| IGNATIUS_INSTALL_DIR=~/bin sh` |
| Pin a version | `npm install -g @noormdev/cli@<version>` | `curl … \| IGNATIUS_VERSION=v0.23.0 sh` |
| `noorm.dev` is blocked | `raw.githubusercontent.com/noormdev/noorm/master/install.sh` | `raw.githubusercontent.com/noormdev/ignatius/main/install.sh` |
| Releases and checksums | [noorm releases](https://github.com/noormdev/noorm/releases) | [ignatius releases](https://github.com/noormdev/ignatius/releases/latest) |

The variable goes on `sh`, after the pipe. Set before `curl`, it reaches only `curl` and the installer never sees it.
