/**
 * Secret value input for `vault set` and `secret set`.
 *
 * A secret passed as a positional argument is visible in the process table
 * (`ps -ww -eo args`), in shell history, and in `set -x` CI traces. `--stdin`
 * is the way to set one without it appearing in any of those.
 *
 * Lives here rather than in `cli/_utils.ts` so both secret writers share one
 * implementation; it is a candidate to move to `_utils.ts` alongside the
 * other shared CLI input helpers.
 */
import { attempt } from '@logosdx/utils';

/**
 * Read the whole of stdin as a UTF-8 string.
 *
 * Strips a single trailing newline so the shell idiom `echo "$X" | noorm
 * vault set K --stdin` stores `$X` and not `$X\n` — `echo` appends one, and a
 * secret with a stray newline fails authentication in confusing ways.
 */
async function readStdin(): Promise<string> {

    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {

        chunks.push(Buffer.from(chunk as Buffer));

    }

    return Buffer.concat(chunks).toString('utf-8').replace(/\r?\n$/, '');

}

/**
 * Resolve a secret value from `--stdin` or the positional argument.
 *
 * @returns [value, null] on success, [null, Error] when the two inputs
 * conflict, neither was supplied, or stdin was empty.
 *
 * @example
 * const [value, err] = await readSecretValue(args);
 * if (err) { process.stderr.write(`Error: ${err.message}\n`); process.exit(1); }
 */
export async function readSecretValue(
    args: { value?: string; stdin?: boolean },
): Promise<[string, null] | [null, Error]> {

    if (args.stdin && args.value !== undefined) {

        return [null, new Error('Pass the value as an argument or via --stdin, not both.')];

    }

    if (args.stdin) {

        const [value, err] = await attempt(() => readStdin());

        if (err) return [null, new Error(`Failed to read the secret value from stdin: ${err.message}`)];

        if (value === '') return [null, new Error('No secret value on stdin.')];

        return [value, null];

    }

    if (args.value === undefined) {

        return [null, new Error('Missing secret value. Pass it as an argument, or pipe it in with --stdin.')];

    }

    return [args.value, null];

}
