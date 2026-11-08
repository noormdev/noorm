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

noorm builds and changes databases. ignatius models them before they exist. Each is one binary with no separate Node.js or Bun runtime to install.

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

On Alpine Linux, the standalone CLI needs `libstdc++`. For the shell installer, install it along with `curl` and CA certificates: `apk add curl ca-certificates libstdc++`. The next CLI release supplies native musl binaries, and the installer automatically selects them. For manual downloads from [noorm releases](https://github.com/noormdev/noorm/releases), choose `noorm-linux-x64-musl` for x64 or `noorm-linux-arm64-musl` for ARM64. Other Linux systems use `noorm-linux-x64` or `noorm-linux-arm64`.

<p class="dl-label">Agent skill</p>

```bash
npx skills add noormdev/noorm/skills
```

<p class="dl-label">SDK, for application code</p>

```bash
npm install @noormdev/sdk kysely pg
```

<p class="dl-small">The SDK needs Node 22.13 or newer, <code>kysely</code>, and your dialect's driver: <code>pg</code> for PostgreSQL, <code>mysql2</code> for MySQL, <code>better-sqlite3</code> for SQLite, or <code>tedious</code> for SQL Server. Drivers are optional peer dependencies; install only the one you use. Tarn is bundled. Verify the CLI with <code>noorm --version</code>; update with <code>noorm update</code>.</p>

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
