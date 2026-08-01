---
title: Installing ignatius
description: Install the ignatius binary and the noorm-modeling skill, then serve, validate, and export your first model.
---

# Installing ignatius


ignatius is a single self-contained binary with no runtime dependency. It runs on machines without Bun or Node installed.


## Install script


The script detects your operating system and architecture, downloads the matching binary from the [latest release](https://github.com/noormdev/ignatius/releases/latest), verifies its checksum, and puts it on your `$PATH`.

```bash
curl -fsSL https://raw.githubusercontent.com/noormdev/ignatius/main/install.sh | sh
```

It installs to `/usr/local/bin` when that directory is writable and `$HOME/.local/bin` otherwise. Two environment variables override the defaults:

- `IGNATIUS_INSTALL_DIR=/some/dir` installs somewhere else.
- `IGNATIUS_VERSION=v0.2.0` pins a release tag instead of taking the latest.

Verify with `ignatius --help`.


## Download a release


To install by hand, or on Windows, take the binary for your platform from the [latest release](https://github.com/noormdev/ignatius/releases/latest).

```bash
# macOS arm64
curl -L -o ignatius https://github.com/noormdev/ignatius/releases/latest/download/ignatius-darwin-arm64
chmod +x ignatius
sudo mv ignatius /usr/local/bin/

# Linux x64
curl -L -o ignatius https://github.com/noormdev/ignatius/releases/latest/download/ignatius-linux-x64
chmod +x ignatius
sudo mv ignatius /usr/local/bin/
```

Windows users take `ignatius-windows-x64.exe` from the same page. Each release includes `checksums.txt` for verifying a manual download with `shasum -a 256 -c`.


## From source


ignatius builds with [Bun](https://bun.com).

```bash
git clone https://github.com/noormdev/ignatius.git
cd ignatius
bun install
bun run build:cli
```

That produces `./dist/ignatius`.


## Staying current


```bash
ignatius version          # print the installed version
ignatius update           # check for a newer release, then prompt
ignatius update --check   # report only, never install
ignatius update --yes     # install without prompting, for scripts
```

`update` downloads the binary for your platform, verifies its checksum against the release `checksums.txt`, and replaces the running executable in place. That needs write access to the installed binary, so a binary in `/usr/local/bin` wants `sudo ignatius update --yes`. Outside a terminal it reports the available version and exits without installing unless you pass `--yes`. Windows binaries cannot replace themselves while running, so on Windows the command points you at the release download instead.


## The modeling skill


To author models from Claude Code, install the `noorm-modeling` skill with the [`skills`](https://www.npmjs.com/package/skills) CLI.

```bash
npx skills add https://github.com/noormdev/ignatius --skill noorm-modeling
```

That adds the skill to the current project's `.claude/skills/`. Add `-g` to install it globally for every project on the machine. Reload skills in Claude Code and `/noorm-modeling` becomes available. See [The modeling skill](/modeling/modeling-skill) for what each mode does.


## Serve a model


Point ignatius at a folder that contains an `ignatius.yml` file.

```bash
ignatius serve path/to/your/models --port 3000
```

Editing any `.md` or `.yaml` file under that folder pushes an update to the open browser tab over server-sent events, so the diagram reloads without a refresh.

The path argument is optional. With no path, ignatius searches up and down from the current directory for a model root. When it finds more than one it prompts you with a list in a terminal, or takes `--model <key>` to skip the prompt. In a non-interactive shell an ambiguous run exits with an error and prints the available keys rather than hanging. The search skips `node_modules`, `.git`, `dist`, `tmp`, `trash`, `.worktrees`, `.claude`, and any path segment starting with `_`.

The default port is 3000. When that port is taken, ignatius counts up to the next free one and asks which to use, with the free port as the default. Run non-interactively it advances automatically and prints the port it settled on. Pass `-o` to open the app in your browser once the server binds, on whichever port it ended up with.

The app has three views, switched without a page reload and reflected in the URL hash: Graph (`#view=graph`), Dictionary (`#view=dict`), and Flows (`#view=flow`). Back, forward, and deep links all work.


## Validate a model


```bash
ignatius validate [path] [--model <key>]
```

`validate` checks the model and reports findings without writing anything. It prints each finding to stderr and a one-line summary to stdout, then exits `1` when the model has errors and `0` otherwise. Warnings alone do not fail the command. When the model has a `flows/` directory the flow rules run too.

That exit-code contract makes it usable as a CI gate. Findings come in two classes: a warning still renders the entity with a badge, while an error omits the broken reference (one edge, one cluster, one unparseable file) and names the omission in a banner. A typo in one of three foreign keys strips that edge and keeps the entity. The [full rule catalog](https://github.com/noormdev/ignatius/blob/main/docs/guides/validation.md) lists every rule and its class.


## Export a model


```bash
ignatius export [path] -o model.html [--theme light|dark] [--model <key>]
```

`export` writes all three views into one HTML file with no external dependencies. View switching, dictionary search, the entity dialog, the theme toggle, and node-position persistence all work offline from `file://`. `-o` is required.

This is the artifact you send to someone who will not install anything. Commit it next to the model, attach it to a ticket, or mail it to the stakeholder whose sign-off you need.


## Keyboard shortcuts


Single-key shortcuts work while no text field is focused and no modifier is held.

| Key | Action |
|---|---|
| `g` | Switch to the Data Graph |
| `d` | Switch to the Dictionary |
| `f` | Switch to the Data Flows |
| `l` | Toggle graph layout, organic or hierarchical (Graph view) |
| `b` | Toggle dictionary lens, read or browse (Dictionary view) |
| `?` | Open the help overlay for the current view |

Zoom acts on the diagram canvas rather than the browser page, and works even while a text field is focused because the chords are not typed characters.

| Input | Action |
|---|---|
| `Cmd`/`Ctrl` + `=` | Zoom in |
| `Cmd`/`Ctrl` + `-` | Zoom out |
| `Cmd`/`Ctrl` + `0` | Fit the diagram to the screen |
| Trackpad pinch | Zoom toward the pointer |


## Next steps


- [Entities and key inheritance](/modeling/entities) covers the folder format and the entity file.
- [Data flows](/modeling/data-flows) covers processes, externals, and stores.
- [The modeling skill](/modeling/modeling-skill) covers authoring from Claude Code.
