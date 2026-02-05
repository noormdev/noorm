/**
 * Logger Initialization
 *
 * Event-driven logger initialization that waits for settings to be loaded
 * before starting. This ensures:
 * 1. We know the log file path from settings
 * 2. We know which fields are secrets (from stages config)
 * 3. We can apply proper redaction based on configured log level
 *
 * @example
 * ```typescript
 * // In CLI entry point (src/cli/index.tsx)
 * import { enableAutoLoggerInit } from '../core/logger/init.js'
 *
 * enableAutoLoggerInit(process.cwd())
 * // ... rest of CLI startup
 * ```
 */
import { createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Writable } from 'node:stream';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { isCi } from '../environment.js';
import { Logger, getLogger, resetLogger } from './logger.js';
import { addSettingsSecrets, listenForSecrets } from './redact.js';
import type { Settings } from '../settings/types.js';

/**
 * Options for auto logger initialization.
 */
export interface AutoLoggerOptions {
    /** Stream for console output (JSON logs). Pass null stream to suppress. */
    console?: Writable;
    /** Stream for diagnostic output (colored/plain logs). Pass null stream to suppress. */
    diagnostics?: Writable;
}

let secretsCleanup: (() => void) | null = null;
let settingsCleanup: (() => void) | null = null;
let logger: Logger | null = null;
let initOptions: AutoLoggerOptions = {};

/**
 * Enable event-driven logger initialization.
 *
 * The logger will automatically start when `settings:loaded` is emitted.
 * Call this once at app startup, before any other initialization.
 *
 * @param projectRoot - Project root directory
 * @param options - Optional configuration for logger streams
 *
 * @example
 * ```typescript
 * // At app startup (headless mode - logs to stderr)
 * enableAutoLoggerInit(process.cwd())
 *
 * // TUI mode - suppress stderr output
 * const nullStream = new Writable({ write: (_, __, cb) => cb() });
 * enableAutoLoggerInit(process.cwd(), { diagnostics: nullStream });
 *
 * // Later, when settings are loaded, logger starts automatically
 * await settingsManager.load() // Emits 'settings:loaded'
 * // Logger is now running and capturing events
 * ```
 */
export function enableAutoLoggerInit(projectRoot: string, options?: AutoLoggerOptions): void {

    // Prevent double registration
    if (settingsCleanup) {

        return;

    }

    // Store options for logger creation
    initOptions = options ?? {};

    // Start listening for secret events BEFORE logger queue is created
    // This ensures any secret:set or global-secret:set events add keys
    // to the masked fields list before they can be logged
    secretsCleanup = listenForSecrets();

    // Wait for settings to be loaded
    settingsCleanup = observer.once('settings:loaded', async (payload) => {

        const { settings } = payload as { settings: Settings };

        // Check if logging is enabled
        if (!settings.logging?.enabled) {

            return;

        }

        // Add settings-defined secrets to redaction list
        addSettingsSecrets(settings);

        // Create file stream (unless CI-only mode)
        let fileStream: Writable | undefined;

        if (!isCi()) {

            const filePath = join(projectRoot, settings.logging.file ?? '.noorm/state/noorm.log');

            // Ensure directory exists
            const [, mkdirErr] = await attempt(() => mkdir(dirname(filePath), { recursive: true }));

            if (!mkdirErr) {

                fileStream = createWriteStream(filePath, { flags: 'a' });

            }

        }

        // Create and start logger
        logger = new Logger({
            projectRoot,
            settings,
            config: settings.logging,
            file: fileStream,
            console: initOptions.console,
            diagnostics: initOptions.diagnostics,
        });

        await logger.start();

    });

}

/**
 * Disable event-driven logger initialization.
 *
 * Cleans up listeners and stops the logger if running.
 * Mainly useful for testing.
 */
export async function disableAutoLoggerInit(): Promise<void> {

    if (secretsCleanup) {

        secretsCleanup();
        secretsCleanup = null;

    }

    if (settingsCleanup) {

        settingsCleanup();
        settingsCleanup = null;

    }

    if (logger) {

        await logger.stop();
        logger = null;

    }

    await resetLogger();

}

/**
 * Get the initialized logger instance.
 *
 * @returns Logger instance or null if not yet initialized
 */
export function getInitializedLogger(): Logger | null {

    return logger ?? getLogger();

}
