/**
 * Global settings manager for ~/.noorm/settings.yml
 *
 * These are user-level settings, not project settings.
 * Stored separately from project's .noorm/settings.yml.
 *
 * Pattern follows identity storage at src/core/identity/storage.ts.
 *
 * @example
 * ```typescript
 * const settings = await loadGlobalSettings();
 * if (settings.checkUpdates) {
 *     await checkForUpdate();
 * }
 * ```
 */
import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { attempt, attemptSync } from '@logosdx/utils';

import { observer } from '../observer.js';
import type { DismissablePreference, GlobalSettings } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** Base directory for noorm global config */
const NOORM_HOME = join(homedir(), '.noorm');

/** Global settings file path */
const GLOBAL_SETTINGS_PATH = join(NOORM_HOME, 'settings.yml');

/** Default global settings */
const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
    checkUpdates: true,
    autoUpdate: false,
};

// =============================================================================
// Testing Support
// =============================================================================

/** Override path for testing (allows using temp directories) */
let testOverridePath: string | null = null;

/**
 * Reset global settings state for testing.
 *
 * Clears any test path overrides.
 */
export function resetGlobalSettingsForTesting(): void {

    testOverridePath = null;

}

/**
 * Set override path for testing.
 *
 * @param path - Directory to use instead of ~/.noorm
 */
export function setTestOverridePath(path: string): void {

    testOverridePath = path;

}

/**
 * Get the current settings file path.
 *
 * Returns test override if set, otherwise real path.
 */
function getSettingsPath(): string {

    if (testOverridePath) {

        return join(testOverridePath, 'settings.yml');

    }

    return GLOBAL_SETTINGS_PATH;

}

/**
 * Get the noorm home directory.
 *
 * Returns test override if set, otherwise real path.
 */
function getNoormHome(): string {

    if (testOverridePath) {

        return testOverridePath;

    }

    return NOORM_HOME;

}

// =============================================================================
// Directory Setup
// =============================================================================

/**
 * Ensure noorm home directory exists.
 */
async function ensureNoormDir(): Promise<void> {

    const [, err] = await attempt(() => mkdir(getNoormHome(), { recursive: true }));

    if (err) {

        throw new Error(`Failed to create ${getNoormHome()}: ${err.message}`);

    }

}

// =============================================================================
// Load / Save
// =============================================================================

/**
 * Load global settings from disk.
 *
 * Returns defaults if file doesn't exist.
 *
 * @returns Global settings
 *
 * @example
 * ```typescript
 * const settings = await loadGlobalSettings();
 * console.log(`Check updates: ${settings.checkUpdates}`);
 * ```
 */
export async function loadGlobalSettings(): Promise<GlobalSettings> {

    const [content, err] = await attempt(() =>
        readFile(getSettingsPath(), { encoding: 'utf8' }),
    );

    if (err) {

        // File doesn't exist = return defaults
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {

            return { ...DEFAULT_GLOBAL_SETTINGS };

        }

        throw new Error(`Failed to read global settings: ${err.message}`);

    }

    // Empty file = return defaults
    if (!content.trim()) {

        return { ...DEFAULT_GLOBAL_SETTINGS };

    }

    const [parsed, parseErr] = attemptSync(() => parseYaml(content) as GlobalSettings);

    if (parseErr) {

        throw new Error(`Failed to parse global settings: ${parseErr.message}`);

    }

    // Merge with defaults for any missing fields
    const settings = {
        ...DEFAULT_GLOBAL_SETTINGS,
        ...parsed,
    };

    observer.emit('global-settings:loaded', { settings });

    return settings;

}

/**
 * Save global settings to disk.
 *
 * Creates ~/.noorm directory if it doesn't exist.
 *
 * @param settings - Settings to save
 *
 * @example
 * ```typescript
 * await saveGlobalSettings({
 *     checkUpdates: true,
 *     autoUpdate: false,
 * });
 * ```
 */
export async function saveGlobalSettings(settings: GlobalSettings): Promise<void> {

    await ensureNoormDir();

    const yaml = stringifyYaml(settings, { indent: 2 });

    const [, err] = await attempt(() =>
        writeFile(getSettingsPath(), yaml, { encoding: 'utf8' }),
    );

    if (err) {

        throw new Error(`Failed to write global settings: ${err.message}`);

    }

}

/**
 * Update a single global setting.
 *
 * Loads current settings, updates the key, and saves.
 *
 * @param key - Setting key to update
 * @param value - New value
 *
 * @example
 * ```typescript
 * await updateGlobalSetting('autoUpdate', true);
 * ```
 */
export async function updateGlobalSetting<K extends keyof GlobalSettings>(
    key: K,
    value: GlobalSettings[K],
): Promise<void> {

    const settings = await loadGlobalSettings();

    settings[key] = value;

    await saveGlobalSettings(settings);

    observer.emit('global-settings:updated', { key, value });

}

/**
 * Update a dismissable alert preference.
 *
 * Handles the nested dismissable object structure.
 *
 * @param alertKey - Alert identifier (e.g., 'majorVersionUpdate')
 * @param preference - User preference for this alert
 *
 * @example
 * ```typescript
 * await updateDismissablePreference('majorVersionUpdate', 'always');
 * ```
 */
export async function updateDismissablePreference(
    alertKey: string,
    preference: DismissablePreference,
): Promise<void> {

    const settings = await loadGlobalSettings();

    settings.dismissable = settings.dismissable ?? {};
    settings.dismissable[alertKey] = preference;

    await saveGlobalSettings(settings);

    observer.emit('global-settings:updated', {
        key: `dismissable.${alertKey}`,
        value: preference,
    });

}

/**
 * Get a dismissable alert preference.
 *
 * Returns 'ask' if not set.
 *
 * @param alertKey - Alert identifier
 * @returns User preference for this alert
 *
 * @example
 * ```typescript
 * const pref = await getDismissablePreference('majorVersionUpdate');
 * if (pref === 'always') {
 *     // Auto-confirm
 * }
 * ```
 */
export async function getDismissablePreference(
    alertKey: string,
): Promise<DismissablePreference> {

    const settings = await loadGlobalSettings();

    return settings.dismissable?.[alertKey] ?? 'ask';

}

// =============================================================================
// Path Accessors
// =============================================================================

/**
 * Get the path to the global settings file.
 */
export function getGlobalSettingsPath(): string {

    return getSettingsPath();

}
