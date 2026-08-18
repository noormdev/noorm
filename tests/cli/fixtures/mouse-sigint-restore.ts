/**
 * Child process for the "SIGINT with no other listener" case.
 *
 * The transport has to restore the terminal on a signal, and it has to do that
 * without becoming the reason the signal stopped killing the process. Both
 * halves need a process that is allowed to die, which rules out asserting them
 * inside the test runner.
 *
 * Writes through `writeSync` rather than `process.stdout.write`: stdout is a
 * pipe here, and Node's pipe writes are asynchronous on POSIX, so a buffered
 * write would be lost when the re-raised signal ends the process.
 */
import { writeSync } from 'node:fs';

import { installTerminalRestore, MOUSE_DISABLE } from '../../../src/tui/mouse.js';

installTerminalRestore(() => {

    writeSync(1, MOUSE_DISABLE);

});

process.kill(process.pid, 'SIGINT');

// Reached only if the transport swallowed the signal. The exit code separates
// that failure from a clean signal death in the parent's assertion.
setTimeout(() => {

    writeSync(1, 'SIGNAL-WAS-SWALLOWED');
    process.exit(7);

}, 2000);
