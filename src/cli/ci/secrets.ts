/**
 * noorm ci secrets — batch-load secrets from a dotenv-style file.
 *
 * Runs after `noorm ci init` inside a CI job. Reads KEY=value lines
 * from --file and writes each entry into the active (or --config-named)
 * vault. Without --overwrite, existing keys are skipped so a rerun is
 * safe; with --overwrite, collisions are replaced.
 *
 * Exit codes: 0 all loaded, 1 nothing loaded (precondition or total
 * failure), 2 partial (some set, some errored) — lets CI distinguish
 * degraded state from clean failure.
 */
import { readFile } from 'node:fs/promises';

import { attempt, attemptSync } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { initState, getStateManager } from '../../core/state/index.js';
import { outputResult, outputError, sharedArgs } from '../_utils.js';

interface DotenvLine {
    key: string;
    value: string;
    lineNumber: number;
}

/**
 * Parse a dotenv-style file body.
 *
 * - Blank lines and `#` comment lines are ignored.
 * - Split on the first `=`; `=` may appear in values.
 * - A single matched pair of surrounding `"` or `'` is stripped.
 *
 * @example
 * parseDotenv('FOO=bar\nURL="https://x.y/?a=1"')
 */
function parseDotenv(content: string): DotenvLine[] {

    const lines = content.split(/\r?\n/);
    const out: DotenvLine[] = [];

    for (let i = 0; i < lines.length; i++) {

        const raw = lines[i] ?? '';
        const trimmed = raw.trim();

        if (!trimmed || trimmed.startsWith('#')) continue;

        const eq = trimmed.indexOf('=');

        if (eq <= 0) {

            throw new Error(`Line ${i + 1}: expected KEY=value, got "${trimmed}"`);

        }

        const key = trimmed.slice(0, eq).trim();

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {

            throw new Error(`Line ${i + 1}: invalid key "${key}"`);

        }

        let value = trimmed.slice(eq + 1);
        const first = value[0];
        const last = value[value.length - 1];

        if (value.length >= 2 && (first === '"' || first === "'") && first === last) {

            value = value.slice(1, -1);

        }

        out.push({ key, value, lineNumber: i + 1 });

    }

    return out;

}

const secretsCommand = defineCommand({
    meta: {
        name: 'secrets',
        description: 'Batch-load secrets from a dotenv file into the active config',
    },
    args: {
        file: {
            type: 'string',
            description: 'Path to a dotenv-style file (KEY=value per line)',
            required: true,
        },
        config: {
            type: 'string',
            description: 'Target config name (defaults to active config)',
        },
        overwrite: {
            type: 'boolean',
            description: 'Overwrite existing secrets (default: skip)',
            default: false,
        },
        json: sharedArgs.json,
    },
    async run({ args }) {

        const projectRoot = process.cwd();

        const [, initErr] = await attempt(() => initState(projectRoot));

        if (initErr) {

            outputError(
                args,
                `Failed to load state (did you run "noorm ci init"?): ${initErr.message}`,
            );
            process.exit(1);

        }

        const stateManager = getStateManager(projectRoot);
        const configName = args.config ?? stateManager.getActiveConfigName();

        if (!configName) {

            outputError(
                args,
                'No config specified and no active config. Run "noorm ci init" or pass --config.',
            );
            process.exit(1);

        }

        if (!stateManager.getConfig(configName)) {

            outputError(args, `Config "${configName}" does not exist.`);
            process.exit(1);

        }

        const [content, readErr] = await attempt(() => readFile(args.file, 'utf8'));

        if (readErr || content === null) {

            outputError(args, `Failed to read ${args.file}: ${readErr?.message ?? 'unknown error'}`);
            process.exit(1);

        }

        const [lines, parseErr] = attemptSync(() => parseDotenv(content));

        if (parseErr || !lines) {

            outputError(args, `Parse error in ${args.file}: ${parseErr?.message ?? 'unknown error'}`);
            process.exit(1);

        }

        const existingKeys: Record<string, true> = {};

        for (const k of stateManager.listSecrets(configName)) {

            existingKeys[k] = true;

        }

        let setCount = 0;
        let skippedCount = 0;
        const errors: { key: string; message: string }[] = [];

        for (const { key, value } of lines) {

            if (existingKeys[key] && !args.overwrite) {

                skippedCount++;
                continue;

            }

            const [, setErr] = await attempt(() => stateManager.setSecret(configName, key, value));

            if (setErr) {

                errors.push({ key, message: setErr.message });
                continue;

            }

            setCount++;

        }

        const errorCount = errors.length;

        outputResult(
            args,
            {
                success: errorCount === 0,
                config: configName,
                set: setCount,
                skipped: skippedCount,
                errors: errorCount,
                errorDetails: errors.slice(0, 5),
            },
            [
                `Loaded secrets into config "${configName}".`,
                `  Set:     ${setCount}`,
                `  Skipped: ${skippedCount}${skippedCount > 0 ? ' (existing; pass --overwrite to replace)' : ''}`,
                `  Errors:  ${errorCount}`,
                ...errors.slice(0, 5).map((e) => `    - ${e.key}: ${e.message}`),
            ].join('\n'),
        );

        if (errorCount === 0) {

            process.exit(0);

        }

        process.exit(setCount > 0 ? 2 : 1);

    },
});

(secretsCommand as typeof secretsCommand & { examples: string[] }).examples = [
    'noorm ci secrets --file ./ci-secrets.env',
    'noorm ci secrets --file ./ci-secrets.env --overwrite',
    'noorm ci secrets --file ./ci-secrets.env --config prod --json',
];

export default secretsCommand;
