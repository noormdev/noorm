import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# CHANGE FF

Fast-forward: apply all pending changesets

## Usage

    noorm change ff [options]
    noorm -H change ff

## Options

    -c, --config NAME   Use specific configuration
    -f, --force         Skip checksum validation
    --dry-run           Preview without executing

## Description

Applies all pending changesets in order. This is the primary command
for running migrations in CI/CD pipelines.

Changesets are applied in alphabetical order by name. Each changeset
is executed within a transaction when supported by the database.

> If a changeset fails, execution stops and subsequent changesets are
> not applied. The failed changeset is marked as 'failed' in the history.

## Examples

    noorm -H change ff
    noorm -H -c prod change ff
    noorm -H --dry-run change ff
    noorm -H --force change ff

## Exit Codes

    0   All changesets applied successfully
    1   One or more changesets failed

## JSON Output

\`\`\`json
{
    "status": "success",
    "executed": 3,
    "skipped": 0,
    "failed": 0,
    "changesets": [
        { "name": "001_init", "status": "success", "durationMs": 45 }
    ]
}
\`\`\`

See \`noorm help change\` or \`noorm help change run\`.
`;

export const run: HeadlessCommand = async (_params, flags, logger) => {

    const [result, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.fastForward(),
    });

    if (error) return 1;

    logger.info(`Fast-forward ${result.status}`, {
        executed: result.executed,
        skipped: result.skipped,
        failed: result.failed,
    });

    for (const cs of result.changesets) {

        logger.info(`  ${cs.name} (${cs.status})`);

    }

    return result.status === 'success' ? 0 : 1;

};
