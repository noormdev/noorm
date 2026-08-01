# Terminal recordings

The GIFs in `docs/public/image/` are generated from the `.tape` files here with
[VHS](https://github.com/charmbracelet/vhs). A tape is a script, not a capture,
so re-recording after a CLI change is one command instead of a fresh take.

| Tape | Output | Shows |
|------|--------|-------|
| `01-install.tape` | `install.gif` | `curl \| sh` install, `identity init`, `noorm init`, `noorm info` |
| `02-build-and-change.tape` | `build-and-change.gif` | `run build`, `change list`, `change ff`, `change history` |
| `03-tui.tape` | `tui.gif` | `noorm ui` — create a config, create the database, build, fast-forward changes, history, explorer |
| `04-screenshots.tape` | `../public/image/tui/*.png` | Stills of every TUI screen, for `tui.md`. Run via `./shots.sh` |


## Prerequisites

```bash
brew install vhs
brew install --cask font-geist-mono   # see "Font" below

bun run build                                             # tapes run dist/cli/index.js
docker compose -f docker-compose.test.yml up -d --wait postgres
```


## Recording

```bash
cd docs/tapes
vhs 01-install.tape
vhs 02-build-and-change.tape
vhs 03-tui.tape
./shots.sh              # 04-screenshots.tape + per-image cropping
```

Each tape builds its own sandbox first, so they can run in any order and none
of them depends on a previous one.

`shots.sh` is a wrapper, not an alternative: `04-screenshots.tape` produces
stills at one canvas size (tall enough for the add-config form, the tallest
screen in the app), and the script crops each one back down to its own content
and re-pads it. Running the tape directly leaves every short screen sitting on
a slab of empty terminal.


## The sandbox

`sandbox.sh` creates `/tmp/noorm-demo` and every tape calls it off-camera:

```
/tmp/noorm-demo/
├── home/       → HOME during the recording; identity lands in home/.noorm
├── bin/noorm   → shim onto dist/cli/index.js
└── project/    → schema copied from demo-project/
```

Three things this buys:

- **Your `~/.noorm` is never touched.** `HOME` is redirected, so
  `noorm identity init` writes to the sandbox. The identity in the GIFs is a
  throwaway keypair generated at record time.
- **Recordings reflect your working tree.** `bin/noorm` runs the local build,
  not whatever version happens to be installed globally. `01-install.tape` is
  the deliberate exception — it runs the real published installer, which
  defaults to `$HOME/.local/bin` and therefore also stays in the sandbox.
- **The path is short.** noorm's diagnostic log prints absolute file paths, and
  a long prefix wraps every line.

Modes: `fresh` (nothing set up), `project` (identity and a project, but no
config and no database — the TUI walkthrough creates both on camera),
`bootstrapped` (identity + config), `built` (also applies the schema).

`sandbox.sh` drops the `noorm_demo` database on the test Postgres container
each run, so recordings never inherit objects from a previous take — that
failure mode shows up as `cannot drop columns from view` mid-build. Every mode
except `project` recreates it immediately; `project` leaves it absent so the
TUI walkthrough can create it on camera.


## The demo schema

`demo-project/` is a 4-file schema: `app_user`, `project`, `task`, and an
`open_task` view, plus two changes that add a `priority` column and update the
view. It models noorm's own argument — `project` and `task` use inherited
compound keys rather than a surrogate ID per table.

The SQL files describe the schema **as it exists today**, including `priority`.
The changes exist for databases built before that column landed, and are
written idempotently (`ADD COLUMN IF NOT EXISTS`) so they are safe on both.

To record against the full example instead:

```bash
NOORM_DEMO_SCHEMA=todo-db ./sandbox.sh bootstrapped
```

Be aware this does not currently produce a usable recording. `run build` logs
one line per file carrying the absolute path twice (~250 characters), so 60
files is thousands of wrapped lines; VHS renders every frame and the build does
not finish inside a 5-minute wait. The 4-file schema exists for that reason.


## Font

Geist Mono is the brand face and is **not** bundled. Without it VHS silently
falls back to a much wider default, and the `Set Width` values here — which are
sized in pixels, not columns — produce a terminal too narrow for the output.
Symptom is every line wrapping mid-path.

Sizing was measured with `tput cols; tput lines`: at `FontSize 16` one Geist
Mono cell is about 10.2 x 22.4 px, so

```
Width  = columns * 10.2 + 64      (64 = Padding * 2)
Height = lines   * 22.4 + 64
```

Re-measure if you change the font or size — do not scale the numbers by eye.


## Notes on VHS

Things that cost time to discover, kept here so they only cost it once:

- **`Type` cannot contain escaped quotes.** `Type "f() { x \"$@\"; }"` is a
  parse error, which is why the `noorm` shim is a file in `sandbox.sh` rather
  than a shell function defined in the tape.
- **A leading underscore in a filename breaks `Source`.** `Source _theme.tape`
  fails to parse; `theme.tape` is fine.
- **The default prompt is `>`, not `$`.** Waits written against `/\$ $/` never
  match. Every tape sets `PS1` explicitly in its hidden block.
- **`Wait` matches the current line; `Wait+Screen` matches the whole screen.**
  Anything that has scrolled needs `Wait+Screen`.
- **Order matters in the hidden block.** Sourcing a file from this directory
  has to happen before the tape `cd`s into the sandbox, or it silently fails
  and `clear` wipes the error.
- Prefer waiting on real output (`/Build completed/`) over waiting on a prompt.
- **`Set PlaybackSpeed 2` shortens the GIF, not the render.** VHS still waits
  out every `Sleep`, so a tape that takes eight minutes to record still does.
  Keep the waits generous and speed up the output instead of trimming Sleeps —
  a shorter wait is what drops a step on a slower machine.
- **Dwells are written for 2x, not 1x.** A `Sleep 2s` holding a block of output
  is only 1s on screen once PlaybackSpeed halves it — not long enough to read
  before the next command or a `clear` wipes it. Output dwells here are 4-6s of
  tape (2-3s visible). Double the tape value, not the visible one.
- **`Hide` is the tool for unavoidable dead air.** `01-install.tape` pulls a
  67 MB binary from GitHub, ~15s of motionless screen that was half the GIF.
  The tape catches the "Installing" line on camera, hides across the transfer,
  and shows again on "Installed". Nothing is faked — the output is the real
  installer's, and only frames where nothing changes get dropped. `Wait` still
  works while hidden, which is what makes this possible.
- **`Screenshot` needs a `Sleep` after it.** The write is flushed
  asynchronously, so without a pause the next keypress can change the screen
  before the PNG lands and you get the *following* screen under the current
  screen's filename. This is silent — the file exists and looks plausible.
- **`Screenshot` rejects absolute paths.** Use a filename relative to wherever
  you invoke `vhs`. It is the fastest way to iterate on a TUI sequence, since
  you get the exact frames you care about without coalescing the whole GIF.

Driving the TUI adds three more, all of which fail *silently* — the recording
looks plausible while the database stays empty, so verify against the database
rather than against the GIF:

- **Enter on a text field submits the whole form.** It does not advance. Only
  Tab and the arrows move between fields. Enter is correct on a select (confirm
  + advance) and on the final checkbox (submit).
- **Run Build and Change FF each gate on a confirm** ("Run 4 SQL files on
  dev?"). Miss the `y` and Escape simply cancels the operation.
- **Navigation is two levels deep**: Home → list → action. One Escape returns
  to the list, a second to Home. One missing Escape sends the next hotkey to
  the wrong screen — `r` on the DB list opens Data Transfer, not Run.


## Known rough edges

Both are in the CLI, not the tapes:

- `run build` at the default log level prints one `file:after` line per file
  with the absolute path repeated in a `filepath=` field. It is too verbose to
  record on a real schema.
- There is no summary-only log level. `NOORM_LOG_LEVEL=warn` suppresses the
  per-file lines *and* the `Build completed` summary, so a successful build
  prints nothing at all. `settings.logging.level` in `.noorm/settings.yml` does
  not gate the diagnostic stream either — only `NOORM_LOG_LEVEL` has any
  effect, and only those two settings exist in practice.
