# noorm settings secret


Declare which secrets a stage requires, from a menu. It writes requirements to `settings.yml` and never stores a value.

```bash
noorm settings secret
```

It prints the current requirements, then loops over Add, Edit, Remove, List, and Done. A requirement has a scope (`Universal`, or one stage), a key, a type (`string`, `password`, `api_key`, or `connection_string`), a description, and a required flag. It lands in `settings.yml`:

```yaml
# .noorm/settings.yml
stages:
    prod:
        secrets:
            - key: PAYMENT_GATEWAY_KEY
              type: password
              required: true
```

A universal requirement sits in the top-level `secrets:` list, and `required` defaults to true. Values are set with [`noorm secret set`](/cli/secret).


## Where does it refuse to run?


| Condition | Behavior |
|-----------|----------|
| `--yes`, `-y`, or `NOORM_YES=1` | `Error: noorm settings secret is interactive only.` Edit the `secrets` section of `settings.yml` directly, and use `noorm secret set <key> <value>` for values. Exit 2 |
| No terminal on stdin | `Error: noorm settings secret requires an interactive terminal.`, exit 2 |
| No `settings.yml` | `Error: No settings.yml found. Run: noorm settings init`, exit 2 |
| `settings.yml` does not load | `Error: Failed to load settings: …`, exit 1 |

`--yes` is the only flag. See [non-interactive operation](/guide/automation/non-interactive).


## Next


- [Stages](/guide/environments/stages#how-do-i-require-a-secret): how a config meets a requirement
- [`noorm secret`](/cli/secret): store the values
