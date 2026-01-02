import { withContext, type HeadlessCommand } from './_helpers.js';

export const help = `
# CHANGE HISTORY

Show change execution history

## Usage

    noorm change history [options]
    noorm -H change history

## Options

    --count N    Show last N records (default: 20)

## Description

Displays the history of change executions including timestamps,
status, and duration. Useful for auditing and debugging.

## Examples

    noorm -H change history
    noorm -H --count 50 change history

## JSON Output

\`\`\`json
[
    {
        "name": "001_init",
        "status": "success",
        "direction": "forward",
        "executedAt": "2024-01-15T10:30:00Z",
        "durationMs": 45
    }
]
\`\`\`

See \`noorm help change\`.
`;

export const run: HeadlessCommand = async (params, flags, logger) => {

    const [history, error] = await withContext({
        flags,
        logger,
        fn: (ctx) => ctx.getHistory(params.count ?? 20),
    });

    if (error) return 1;

    logger.info(`Execution History: ${history.length} records`);

    for (const record of history) {

        const date = new Date(record.executedAt).toLocaleString();
        logger.info(`  ${record.name} - ${record.status} (${date})`);

    }

    return 0;

};
