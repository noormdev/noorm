/**
 * Auto-update module.
 *
 * Provides background update checking and installation.
 *
 * @example
 * ```typescript
 * import { checkForUpdate, installUpdate, loadGlobalSettings } from './update';
 *
 * const settings = await loadGlobalSettings();
 *
 * if (settings.checkUpdates) {
 *     const result = await checkForUpdate();
 *
 *     if (result?.updateAvailable && settings.autoUpdate) {
 *         await installUpdate(result.latestVersion);
 *     }
 * }
 * ```
 */

// Types
export type {
    DismissablePreference,
    GlobalSettings,
    UpdateCheckResult,
    UpdateResult,
    UpdateEvents,
} from './types.js';

// Global settings
export {
    loadGlobalSettings,
    saveGlobalSettings,
    updateGlobalSetting,
    updateDismissablePreference,
    getDismissablePreference,
    getGlobalSettingsPath,
    resetGlobalSettingsForTesting,
    setTestOverridePath,
} from './global-settings.js';

// Registry client
export {
    fetchPackageInfo,
    getLatestForChannel,
    getVersionsOnChannel,
    type RegistryPackageInfo,
} from './registry.js';

// Version checker
export {
    getCurrentVersion,
    parsePrerelease,
    isMajorVersionUpdate,
    compareVersions,
    checkForUpdate,
    type PrereleaseInfo,
} from './checker.js';

// Updater
export { installUpdate } from './updater.js';
