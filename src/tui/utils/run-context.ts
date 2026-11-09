import type { Dialect } from '../../core/connection/types.js';
import { hasServerSideCancel } from '../../core/connection/session.js';

/**
 * What a run screen says after the user confirms a cancel.
 *
 * Postgres and mysql get a server-side cancel, so the running statement stops
 * now. Elsewhere the runner can only decline to start the next file, and
 * saying "cancelling" would claim a stop that has not happened.
 *
 * @example
 * <Text color="yellow">{runCancelMessage(config.connection.dialect)}</Text>
 */
export function runCancelMessage(dialect: Dialect): string {

    return hasServerSideCancel(dialect)
        ? 'Cancelling. The server was asked to stop the running statement.'
        : 'Stopping after the current file finishes.';

}
