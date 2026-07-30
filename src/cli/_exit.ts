/**
 * Process exit codes shared by every noorm CLI command.
 *
 * A CI pipeline has to tell "you named something that isn't there" apart
 * from "the work ran and half of it failed" without parsing prose. Before
 * this module, `2` meant partial failure on `run build`, total failure on
 * `run dir`, and "there was no lock to release" on `lock force` — so the
 * only check that held across commands was `!= 0`, which throws away the
 * distinction that matters most: is the database now in a mixed state?
 *
 * `PARTIAL` is 3 rather than 2 because a partial result is the one code a
 * pipeline must never conflate with a clean failure — a clean failure can
 * be retried, a partial one needs a human. Freeing 2 for `USAGE` follows
 * the GNU convention and leaves 1 as the catch-all it already is at 235
 * call sites.
 *
 * @example
 * process.exit(exitCodeForStatus(result.status));
 */
export const EXIT = {
    /** Everything the caller asked for happened. */
    SUCCESS: 0,

    /** The operation ran and wholly failed — no unit of work succeeded. */
    FAILURE: 1,

    /**
     * The invocation itself was wrong: a malformed or missing flag, a
     * TTY-only command run non-interactively, or a named target (file,
     * directory, config, change, glob) that does not exist. Nothing was
     * attempted, so nothing was changed.
     */
    USAGE: 2,

    /**
     * Some units of work succeeded and some failed. The target is in a
     * mixed state and re-running is not automatically safe.
     */
    PARTIAL: 3,
} as const;

export type ExitCode = typeof EXIT[keyof typeof EXIT];

/**
 * Map a core batch/operation status onto an exit code.
 *
 * Unknown statuses collapse to `FAILURE` rather than `SUCCESS` on purpose:
 * a status this layer does not recognise is not evidence that the work
 * succeeded, and reporting success on no evidence is the defect this
 * whole contract exists to prevent.
 *
 * @example
 * process.exit(exitCodeForStatus(res.status)); // 'partial' -> 3
 */
export function exitCodeForStatus(status: string | undefined): ExitCode {

    if (status === 'success' || status === 'skipped') return EXIT.SUCCESS;
    if (status === 'partial') return EXIT.PARTIAL;

    return EXIT.FAILURE;

}

/**
 * Whether a core status string represents an unqualified success.
 *
 * Shared with `outputResult` so the `--json` envelope's `success` flag and
 * the process exit code can never disagree — they are derived from the
 * same predicate rather than computed independently at each call site.
 */
export function isSuccessStatus(status: string | undefined): boolean {

    return exitCodeForStatus(status) === EXIT.SUCCESS;

}
