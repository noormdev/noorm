/** Login rules every pooled dialect shares. */
import { observer } from '../observer.js';

/**
 * A password callback's rejection that was not an object, carried as an
 * Error with the rejected value as its `cause`.
 *
 * Drivers, Kysely's pools, and `attempt` test an error for truthiness, so a
 * bare `Promise.reject()` would otherwise read as a login that succeeded, and
 * pg captures a stack trace on whatever it is given, which throws on a string.
 *
 * @example
 * if (err instanceof PasswordCallbackRejection) throw err.cause;
 */
export class PasswordCallbackRejection extends Error {

    override readonly name = 'PasswordCallbackRejection' as const;

    constructor(cause: unknown) {

        super('The password callback rejected with a value that is not an error', { cause });

    }

}

/**
 * Wrap a password callback so that it only ever rejects with an object.
 *
 * An object passes through as the same value.
 *
 * @example
 * const password = guardPasswordCallback(runtime.password);
 */
export function guardPasswordCallback(password: () => string | Promise<string>): () => Promise<string> {

    return () => Promise.resolve().then(password).then(undefined, (reason: unknown) => {

        throw typeof reason === 'object' && reason !== null ? reason : new PasswordCallbackRejection(reason);

    });

}

/**
 * Report the logins a pool makes after its first one.
 *
 * The caller of the first connect reports its own failure; later logins have
 * nobody waiting on them. The message is fixed because a driver error can
 * quote a credential.
 *
 * @example
 * const logins = trackPoolLogins(configName, 'MySQL');
 * if (err) logins.failed();
 * else logins.opened();
 */
export function trackPoolLogins(configName: string, label: string) {

    let opened = false;

    return {
        opened(): void {

            opened = true;

        },
        failed(): void {

            if (opened) observer.emit('connection:error', { configName, phase: 'login', error: `${label} pool login failed` });

        },
    };

}
