/**
 * CLI Test Helpers.
 *
 * Shared assertions for tests that drive citty's real `parseArgs` against a
 * command's actual `args` definition instead of a hand-rolled stand-in.
 */
import type { ArgsDef } from 'citty';

/**
 * Asserts that a citty command's `args` property is a resolved ArgsDef
 * object. Commands may declare `args` as an async factory, but `parseArgs`
 * needs the resolved object, not the Promise or an unset value.
 *
 * @example
 * const argsDef = someCommand.args;
 * assertArgsDef(argsDef);
 * const parsed = parseArgs(['--flag', 'value'], argsDef);
 */
export function assertArgsDef(value: unknown): asserts value is ArgsDef {

    if (!value || typeof value !== 'object' || value instanceof Promise) {

        throw new Error('command.args must be a resolved ArgsDef object');

    }

}
