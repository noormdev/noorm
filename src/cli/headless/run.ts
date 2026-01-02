import { type HeadlessCommand } from './_helpers.js';
import { formatHelp } from '../../core/help-formatter.js';

export const help = `
# RUN

Execute SQL files

## Usage

    noorm run [subcommand] [options]

## Subcommands

    build           Execute all SQL files in schema directory
    file PATH       Execute a single SQL file
    dir PATH        Execute all SQL files in a directory

## Description

Run SQL files directly against the database. Unlike changes,
these are not tracked for migration history.

Build mode executes files in the \`sql/\` directory in order,
tracking checksums to skip unchanged files on subsequent runs.

## Options

    -f, --force     Force execution (skip checksum validation)
    --dry-run       Preview without executing

## Examples

    noorm -H run build
    noorm -H run file seed.sql
    noorm -H run dir migrations/
    noorm -H --force run build

## JSON Output

\`\`\`json
{
    "status": "success",
    "filesRun": 5,
    "filesSkipped": 2,
    "filesFailed": 0,
    "durationMs": 1234
}
\`\`\`

See \`noorm help run build\` or \`noorm help change ff\`.
`;

export const run: HeadlessCommand = async (_params, flags, _logger) => {

    const output = flags.json ? help : formatHelp(help);
    process.stdout.write(output + '\\n');

    return 0;

};
