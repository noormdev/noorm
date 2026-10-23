# noorm settings edit


Edit `.noorm/settings.yml` from a menu instead of by hand.

```bash
noorm settings edit
```

The menu offers Paths, Build, Strict, Logging, Stages, Rules, Teardown, and Done. Each section saves as soon as its prompts finish. Cancelling inside a section drops that section's edit and returns to the menu. Done, or a cancel at the menu, exits 0 with `Settings saved.`


## Where does it refuse to run?


It needs a terminal. `settings.yml` is plain YAML, so a script edits the file itself.

| Condition | Behavior |
|-----------|----------|
| `--yes`, `-y`, or `NOORM_YES=1` | `Error: noorm settings edit is interactive only.` Edit `settings.yml` directly, then run `noorm settings build` to validate. Exit 2 |
| No terminal on stdin | `Error: noorm settings edit requires an interactive terminal.`, exit 2 |
| No `settings.yml` | `Error: No settings.yml found. Run: noorm settings init`, exit 2 |
| `settings.yml` does not load | `Error: Failed to load settings: …`, exit 1 |

`--yes` is the only flag, and it exists for the redirect above. See [non-interactive operation](/guide/automation/non-interactive).


## Next


- [`noorm settings secret`](/cli/settings-secret): declare required secrets per stage
- [Stages](/guide/environments/stages)
