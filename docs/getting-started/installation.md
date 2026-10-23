# Installation


Install the noorm CLI, then the SDK and the agent skill if you need them.

```bash
curl -fsSL https://noorm.dev/install.sh | sh
```

```
Installing noorm v1.5.1 (darwin-arm64) to /Users/ada/.local/bin...
Installed noorm v1.5.1 to /Users/ada/.local/bin/noorm
```

```bash
noorm --version
```

```
1.5.1
```

The binary needs no runtime and includes the database drivers for PostgreSQL, MySQL, SQLite, and SQL Server. For npm, Windows, and the GitHub mirror, see [Download](/download).

`noorm` on its own prints the command list. `noorm ui` opens the [terminal UI](/tui).


## Install the SDK (optional)


The SDK needs Node 22.13 or newer, `kysely`, and the driver for your dialect:

```bash
npm install @noormdev/sdk kysely pg
```

| Dialect | Driver |
|---|---|
| PostgreSQL | `pg` |
| MySQL | `mysql2` |
| SQLite | `better-sqlite3` |
| SQL Server | `tedious` and `tarn` |

Drivers are optional peer dependencies, so install only the one you use.


## Install the agent skill (optional)


The skill tells your coding agent where SQL goes in a noorm project, how SDK calls report errors, and which CLI flags CI needs, so it stops guessing.

```bash
npx skills add noormdev/noorm/skills
```

Without Node.js, GitHub CLI 2.90 or newer installs the same skill:

```bash
gh skill install noormdev/noorm skills/noorm
```


## Update noorm


```bash
noorm update
```

After a successful update, noorm offers the skill, using the same commands:

| Where `noorm update` runs | Skill step |
|---|---|
| A terminal, with `npx` or `gh` on `PATH` | Asks before it installs or updates the skill |
| Piped output, with `npx` or `gh` on `PATH` | Prints the command to run |
| Neither `npx` nor `gh` on `PATH` | Prints both commands and where to get Node.js and the GitHub CLI |
| `--json` | Skips the offer |

A declined or failed skill install does not change the exit code. From the TUI, press `u` on the home screen.


## How is the download verified?


The npm package, `noorm update`, and the script at `raw.githubusercontent.com/noormdev/noorm/master/install.sh` compare the binary's SHA-256 with the `checksums.txt` published beside it. A mismatch always aborts. The short script at `noorm.dev/install.sh` does not check yet; install with the GitHub URL when you want the check.

If `checksums.txt` cannot be fetched, they stop. `NOORM_INSECURE=1` overrides that case only:

```bash
curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | NOORM_INSECURE=1 sh
noorm update --insecure
```


## What bites


| Symptom | Cause | Fix |
|---|---|---|
| `noorm: command not found` | The install directory is not on `PATH` | Add the `export PATH="<dir>:$PATH"` line the installer prints to your shell profile |
| `NOORM_INSTALL_DIR` has no effect | The variable was set before `curl`, so only `curl` sees it | Set it after the pipe: `curl … \| NOORM_INSTALL_DIR=~/bin sh` |
| Install stops with "could not verify checksum" | `checksums.txt` is unreachable or has no entry for your platform | Retry, or set `NOORM_INSECURE=1` as shown above |
| The SDK cannot connect and reports a missing driver | The driver is a peer dependency | Install the driver for your dialect |


## Next


- [First build](/getting-started/first-build): `noorm init`, a config, and a built schema
- [Concepts](/getting-started/concepts): the two folders and how databases reach the same schema
- [Download](/download): every install method and option
