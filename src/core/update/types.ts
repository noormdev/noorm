/**
 * Type definitions for auto-update feature.
 *
 * Includes global settings structure and update check/result types.
 */

// =============================================================================
// Dismissable Preferences
// =============================================================================

/**
 * Dismissable alert preference.
 *
 * Controls how alerts are handled after user makes a choice:
 * - 'ask': Show the alert and ask user each time (default)
 * - 'always': Always perform the action without asking
 * - 'never': Never perform the action, auto-deny
 */
export type DismissablePreference = 'ask' | 'always' | 'never';

// =============================================================================
// Global Settings
// =============================================================================

/**
 * Global settings stored in ~/.noorm/settings.yml
 *
 * These are user-level settings, separate from project settings.
 * Used for preferences that apply across all projects.
 */
export interface GlobalSettings {
    /** Check for updates on TUI launch (default: true) */
    checkUpdates: boolean;

    /** Auto-install updates without prompting (default: false) */
    autoUpdate: boolean;

    /** Last check timestamp (ISO string) */
    lastCheck?: string;

    /** Cached latest version from last check */
    cachedVersion?: string;

    /**
     * Dismissable alert preferences.
     *
     * Stores user decisions for alerts that can be permanently dismissed.
     * Keys are alert identifiers (e.g., 'majorVersionUpdate').
     */
    dismissable?: Record<string, DismissablePreference>;
}

// =============================================================================
// Update Check
// =============================================================================

/**
 * Result from checking npm registry for updates.
 */
export interface UpdateCheckResult {
    /** Current installed version */
    currentVersion: string;

    /** Latest available version */
    latestVersion: string;

    /** Whether an update is available */
    updateAvailable: boolean;

    /** Whether this is a major version update (e.g., 1.x.x -> 2.x.x) */
    isMajorUpdate: boolean;

    /** Whether current version is a pre-release */
    isPrerelease: boolean;

    /** Pre-release channel (alpha, beta, rc) if applicable */
    channel?: string;
}

// =============================================================================
// Update Installation
// =============================================================================

/**
 * Result from installing an update.
 */
export interface UpdateResult {
    /** Whether installation succeeded */
    success: boolean;

    /** Version before update */
    previousVersion: string;

    /** Version after update (or attempted version) */
    newVersion: string;

    /** Error message if installation failed */
    error?: string;
}

// =============================================================================
// Observer Events
// =============================================================================

/**
 * Events emitted by the update module.
 *
 * Used to integrate with the observer event system.
 */
export interface UpdateEvents {
    // Update checking
    'update:checking': Record<string, never>;
    'update:available': { currentVersion: string; latestVersion: string };
    'update:major-available': { currentVersion: string; latestVersion: string };
    'update:not-available': { currentVersion: string };
    'update:check-failed': { error: string };

    // Update installation
    'update:installing': { version: string };
    'update:complete': { previousVersion: string; newVersion: string };
    'update:failed': { version: string; error: string };
    'update:skipped': { version: string; reason: 'user-denied' | 'user-deferred' };

    // Global settings
    'global-settings:loaded': { settings: GlobalSettings };
    'global-settings:updated': { key: string; value: unknown };
}
