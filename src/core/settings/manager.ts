/**
 * Settings Manager
 *
 * Loads, validates, and provides access to project settings from .noorm/settings.yml.
 * Settings are version controlled and shared across the team (unlike encrypted state).
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { attempt } from '@logosdx/utils'

import { observer } from '../observer.js'
import { parseSettings, SettingsValidationError } from './schema.js'
import { DEFAULT_SETTINGS, SETTINGS_FILE_PATH, SETTINGS_DIR_PATH, createDefaultSettings } from './defaults.js'
import { evaluateRules, getEffectiveBuildPaths } from './rules.js'

import type {
    Settings,
    Stage,
    Rule,
    BuildConfig,
    PathConfig,
    StrictConfig,
    LoggingConfig,
    RulesEvaluationResult,
    ConfigForRuleMatch,
} from './types.js'


/**
 * Options for SettingsManager construction.
 */
export interface SettingsManagerOptions {

    /** Override settings directory (default: .noorm) */
    settingsDir?: string

    /** Override settings file name (default: settings.yml) */
    settingsFile?: string
}


/**
 * Manages project settings from .noorm/settings.yml.
 *
 * Settings are loaded once and cached. Changes are persisted immediately.
 *
 * @example
 * ```typescript
 * const manager = new SettingsManager(process.cwd())
 * await manager.load()
 *
 * const stage = manager.getStage('prod')
 * const paths = manager.getPaths()
 * ```
 */
export class SettingsManager {

    #projectRoot: string
    #settingsDir: string
    #settingsFile: string
    #settings: Settings | null = null
    #loaded = false

    constructor(projectRoot: string, options: SettingsManagerOptions = {}) {

        this.#projectRoot = projectRoot
        this.#settingsDir = options.settingsDir ?? SETTINGS_DIR_PATH
        this.#settingsFile = options.settingsFile ?? 'settings.yml'
    }

    // ─────────────────────────────────────────────────────────────
    // Path Helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Get the full path to the settings directory.
     */
    get settingsDirPath(): string {

        return join(this.#projectRoot, this.#settingsDir)
    }

    /**
     * Get the full path to the settings file.
     */
    get settingsFilePath(): string {

        return join(this.settingsDirPath, this.#settingsFile)
    }

    // ─────────────────────────────────────────────────────────────
    // Loading / Saving
    // ─────────────────────────────────────────────────────────────

    /**
     * Check if the settings file exists.
     */
    async exists(): Promise<boolean> {

        const [_, err] = await attempt(() => access(this.settingsFilePath))

        return !err
    }

    /**
     * Load settings from disk.
     *
     * If the file doesn't exist, returns default settings without error.
     * Invalid YAML or schema violations throw errors.
     *
     * @throws SettingsValidationError if settings are invalid
     *
     * @example
     * ```typescript
     * const manager = new SettingsManager(process.cwd())
     * await manager.load()
     *
     * if (!manager.isLoaded) {
     *     console.log('Using default settings')
     * }
     * ```
     */
    async load(): Promise<Settings> {

        const fileExists = await this.exists()

        if (!fileExists) {

            this.#settings = createDefaultSettings()
            this.#loaded = true

            observer.emit('settings:loaded', {
                path: this.settingsFilePath,
                settings: this.#settings,
                fromFile: false,
            })

            return this.#settings
        }

        // Read file
        const [content, readErr] = await attempt(() =>
            readFile(this.settingsFilePath, 'utf-8')
        )

        if (readErr) {

            throw new Error(`Failed to read settings file: ${readErr.message}`)
        }

        // Parse YAML
        const [parsed, yamlErr] = await attempt(() => parseYaml(content))

        if (yamlErr) {

            throw new Error(`Invalid YAML in settings file: ${yamlErr.message}`)
        }

        // Handle empty file
        if (parsed === null || parsed === undefined) {

            this.#settings = createDefaultSettings()
            this.#loaded = true

            observer.emit('settings:loaded', {
                path: this.settingsFilePath,
                settings: this.#settings,
                fromFile: true,
            })

            return this.#settings
        }

        // Validate and parse with defaults
        this.#settings = parseSettings(parsed)
        this.#loaded = true

        observer.emit('settings:loaded', {
            path: this.settingsFilePath,
            settings: this.#settings,
            fromFile: true,
        })

        return this.#settings
    }

    /**
     * Save current settings to disk.
     *
     * Creates the settings directory if it doesn't exist.
     *
     * @example
     * ```typescript
     * await manager.load()
     * // ... modify settings ...
     * await manager.save()
     * ```
     */
    async save(): Promise<void> {

        this.#assertLoaded()

        // Ensure directory exists
        const [_, mkdirErr] = await attempt(() =>
            mkdir(this.settingsDirPath, { recursive: true })
        )

        if (mkdirErr) {

            throw new Error(`Failed to create settings directory: ${mkdirErr.message}`)
        }

        // Stringify to YAML
        const yaml = stringifyYaml(this.#settings, {
            indent: 4,
            lineWidth: 120,
        })

        // Write file
        const [__, writeErr] = await attempt(() =>
            writeFile(this.settingsFilePath, yaml, 'utf-8')
        )

        if (writeErr) {

            throw new Error(`Failed to write settings file: ${writeErr.message}`)
        }

        observer.emit('settings:saved', { path: this.settingsFilePath })
    }

    /**
     * Initialize a new settings file with defaults.
     *
     * @param force - Overwrite existing file if true
     * @throws Error if file exists and force is false
     */
    async init(force = false): Promise<void> {

        const fileExists = await this.exists()

        if (fileExists && !force) {

            throw new Error('Settings file already exists. Use force=true to overwrite.')
        }

        this.#settings = createDefaultSettings()
        this.#loaded = true

        await this.save()

        observer.emit('settings:initialized', {
            path: this.settingsFilePath,
            force,
        })
    }

    // ─────────────────────────────────────────────────────────────
    // Accessors
    // ─────────────────────────────────────────────────────────────

    /**
     * Whether settings have been loaded.
     */
    get isLoaded(): boolean {

        return this.#loaded
    }

    /**
     * Get the raw settings object.
     *
     * @throws Error if not loaded
     */
    get settings(): Settings {

        this.#assertLoaded()

        return this.#settings!
    }

    /**
     * Get build configuration.
     */
    getBuild(): BuildConfig {

        this.#assertLoaded()

        return this.#settings!.build ?? DEFAULT_SETTINGS.build!
    }

    /**
     * Get path configuration.
     */
    getPaths(): PathConfig {

        this.#assertLoaded()

        return this.#settings!.paths ?? DEFAULT_SETTINGS.paths!
    }

    /**
     * Get all rules.
     */
    getRules(): Rule[] {

        this.#assertLoaded()

        return this.#settings!.rules ?? []
    }

    /**
     * Get all stages.
     */
    getStages(): Record<string, Stage> {

        this.#assertLoaded()

        return this.#settings!.stages ?? {}
    }

    /**
     * Get a specific stage by name.
     */
    getStage(name: string): Stage | undefined {

        return this.getStages()[name]
    }

    /**
     * Check if a stage exists.
     */
    hasStage(name: string): boolean {

        return name in this.getStages()
    }

    /**
     * Get strict mode configuration.
     */
    getStrict(): StrictConfig {

        this.#assertLoaded()

        return this.#settings!.strict ?? DEFAULT_SETTINGS.strict!
    }

    /**
     * Get logging configuration.
     */
    getLogging(): LoggingConfig {

        this.#assertLoaded()

        return this.#settings!.logging ?? DEFAULT_SETTINGS.logging!
    }

    // ─────────────────────────────────────────────────────────────
    // Rule Evaluation
    // ─────────────────────────────────────────────────────────────

    /**
     * Evaluate rules against a config.
     *
     * @example
     * ```typescript
     * const result = manager.evaluateRules(activeConfig)
     * // { matchedRules: [...], include: [...], exclude: [...] }
     * ```
     */
    evaluateRules(config: ConfigForRuleMatch): RulesEvaluationResult {

        this.#assertLoaded()

        const rules = this.getRules()

        return evaluateRules(rules, config)
    }

    /**
     * Get effective build paths for a config.
     *
     * Combines build config with evaluated rules.
     *
     * @example
     * ```typescript
     * const { include, exclude } = manager.getEffectiveBuildPaths(config)
     *
     * // Build only these paths
     * for (const path of include) {
     *     if (!exclude.includes(path)) {
     *         await buildPath(path)
     *     }
     * }
     * ```
     */
    getEffectiveBuildPaths(config: ConfigForRuleMatch): { include: string[]; exclude: string[] } {

        this.#assertLoaded()

        const build = this.getBuild()
        const rules = this.getRules()

        return getEffectiveBuildPaths(
            build.include ?? ['schema'],
            build.exclude ?? [],
            rules,
            config
        )
    }

    // ─────────────────────────────────────────────────────────────
    // Stage Helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Check if a stage is locked (configs cannot be deleted).
     */
    isStageLockedByName(stageName: string): boolean {

        const stage = this.getStage(stageName)

        return stage?.locked === true
    }

    /**
     * Get required secrets for a stage.
     *
     * Returns only secrets marked as required (default: true).
     */
    getRequiredSecrets(stageName: string): { key: string; type: string; description?: string }[] {

        const stage = this.getStage(stageName)

        if (!stage?.secrets) {

            return []
        }

        return stage.secrets
            .filter((s) => s.required !== false)
            .map((s) => ({
                key: s.key,
                type: s.type,
                description: s.description,
            }))
    }

    /**
     * Get stage defaults.
     *
     * Returns empty object if stage doesn't exist or has no defaults.
     */
    getStageDefaults(stageName: string): NonNullable<Stage['defaults']> {

        const stage = this.getStage(stageName)

        return stage?.defaults ?? {}
    }

    /**
     * Check if a stage enforces protected: true.
     *
     * When a stage has protected: true in defaults, configs
     * linked to that stage cannot override it to false.
     */
    stageEnforcesProtected(stageName: string): boolean {

        const defaults = this.getStageDefaults(stageName)

        return defaults.protected === true
    }

    /**
     * Check if a stage enforces isTest: true.
     *
     * When a stage has isTest: true in defaults, configs
     * linked to that stage cannot override it to false.
     */
    stageEnforcesIsTest(stageName: string): boolean {

        const defaults = this.getStageDefaults(stageName)

        return defaults.isTest === true
    }

    // ─────────────────────────────────────────────────────────────
    // Strict Mode
    // ─────────────────────────────────────────────────────────────

    /**
     * Check if strict mode is enabled.
     */
    isStrictModeEnabled(): boolean {

        return this.getStrict().enabled === true
    }

    /**
     * Get required stages for strict mode.
     */
    getRequiredStages(): string[] {

        const strict = this.getStrict()

        if (!strict.enabled) {

            return []
        }

        return strict.stages ?? []
    }

    // ─────────────────────────────────────────────────────────────
    // Mutations
    // ─────────────────────────────────────────────────────────────

    /**
     * Set a stage definition.
     *
     * @example
     * ```typescript
     * await manager.setStage('prod', {
     *     description: 'Production database',
     *     locked: true,
     *     defaults: { dialect: 'postgres', protected: true },
     * })
     * ```
     */
    async setStage(name: string, stage: Stage): Promise<void> {

        this.#assertLoaded()

        if (!this.#settings!.stages) {

            this.#settings!.stages = {}
        }

        this.#settings!.stages[name] = stage

        await this.save()

        observer.emit('settings:stage-set', { name, stage })
    }

    /**
     * Remove a stage definition.
     */
    async removeStage(name: string): Promise<boolean> {

        this.#assertLoaded()

        if (!this.#settings!.stages || !(name in this.#settings!.stages)) {

            return false
        }

        delete this.#settings!.stages[name]

        await this.save()

        observer.emit('settings:stage-removed', { name })

        return true
    }

    /**
     * Add a rule.
     */
    async addRule(rule: Rule): Promise<void> {

        this.#assertLoaded()

        if (!this.#settings!.rules) {

            this.#settings!.rules = []
        }

        this.#settings!.rules.push(rule)

        await this.save()

        observer.emit('settings:rule-added', { rule })
    }

    /**
     * Remove a rule by index.
     */
    async removeRule(index: number): Promise<boolean> {

        this.#assertLoaded()

        if (!this.#settings!.rules || index < 0 || index >= this.#settings!.rules.length) {

            return false
        }

        const [removed] = this.#settings!.rules.splice(index, 1)

        await this.save()

        observer.emit('settings:rule-removed', { index, rule: removed })

        return true
    }

    /**
     * Update build configuration.
     */
    async setBuild(build: BuildConfig): Promise<void> {

        this.#assertLoaded()

        this.#settings!.build = build

        await this.save()

        observer.emit('settings:build-updated', { build })
    }

    /**
     * Update path configuration.
     */
    async setPaths(paths: PathConfig): Promise<void> {

        this.#assertLoaded()

        this.#settings!.paths = paths

        await this.save()

        observer.emit('settings:paths-updated', { paths })
    }

    /**
     * Update strict mode configuration.
     */
    async setStrict(strict: StrictConfig): Promise<void> {

        this.#assertLoaded()

        this.#settings!.strict = strict

        await this.save()

        observer.emit('settings:strict-updated', { strict })
    }

    /**
     * Update logging configuration.
     */
    async setLogging(logging: LoggingConfig): Promise<void> {

        this.#assertLoaded()

        this.#settings!.logging = logging

        await this.save()

        observer.emit('settings:logging-updated', { logging })
    }

    // ─────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Assert that settings have been loaded.
     */
    #assertLoaded(): void {

        if (!this.#loaded || !this.#settings) {

            throw new Error('SettingsManager not loaded. Call load() first.')
        }
    }
}


// ─────────────────────────────────────────────────────────────
// Singleton / Reset Pattern
// ─────────────────────────────────────────────────────────────

let settingsManagerInstance: SettingsManager | null = null


/**
 * Get or create a SettingsManager instance for a project.
 *
 * @example
 * ```typescript
 * const manager = getSettingsManager(process.cwd())
 * await manager.load()
 * ```
 */
export function getSettingsManager(
    projectRoot: string,
    options?: SettingsManagerOptions
): SettingsManager {

    if (!settingsManagerInstance) {

        settingsManagerInstance = new SettingsManager(projectRoot, options)
    }

    return settingsManagerInstance
}


/**
 * Reset the singleton instance.
 *
 * Useful for testing to ensure clean state between tests.
 */
export function resetSettingsManager(): void {

    settingsManagerInstance = null
}
