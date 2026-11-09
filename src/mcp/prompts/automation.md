Help me automate this noorm workflow: {%~ JSON.stringify($.task) %}.
{% if ($.config) { %}Use the saved config {%~ JSON.stringify($.config) %} explicitly on each database command.{% } else { %}Inspect the project to choose a saved config or environment-only connection; ask if the intended target is unclear.{% } %}
1. Read existing scripts, package commands, .noorm/settings.yml, and the relevant SQL/change files. Check the installed CLI command help before choosing flags.
2. For environment-only connections, require NOORM_CONNECTION_DIALECT and NOORM_CONNECTION_DATABASE plus the dialect-specific connection variables. Read credentials from the environment or a secret store, never inline or log them.
3. Write a script using supported headless commands such as noorm run build, noorm change ff, or noorm run file. Choose the operation for the requested task; do not rebuild or reset a populated database as a deployment shortcut.
4. For a shell script, use set -euo pipefail and quote arguments. Use --json when consuming command results, keep stderr separate, and propagate nonzero exit codes. Exit 3 means partial success: inspect state before repair, not blind retry.
5. Verify against a disposable target first and report the commands, target, observed output, and failure behavior. Do not execute against a shared database unless explicitly requested.
Agent CLI calls cannot satisfy confirm permissions, even with --yes or NOORM_YES. Do not change NOORM_CHANNEL, roles, or policy to evade that boundary. MCP operations requiring confirmation must use human elicitation.
For an independently authorized human-run script, document any required --yes confirmation per command; it never overrides deny. Do not set blanket NOORM_YES as a workaround for agent refusal.
