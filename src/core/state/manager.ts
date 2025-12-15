/**
 * StateManager - Core state persistence with encryption.
 *
 * Handles loading, saving, and managing encrypted state.
 * All config and secret operations go through this class.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { attemptSync } from '@logosdx/utils'
import type { Config } from '../config/types.js'
import { encrypt, decrypt } from './encryption/index.js'
import type { State, ConfigSummary, EncryptedPayload } from './types.js'
import { createEmptyState } from './types.js'
import { migrateState, needsMigration } from './migrations.js'
import { getPackageVersion } from './version.js'
import { observer } from '../observer.js'


const DEFAULT_STATE_DIR = '.noorm'
const DEFAULT_STATE_FILE = 'state.enc'


/**
 * Options for StateManager constructor.
 */
export interface StateManagerOptions {

    /** Encryption passphrase (defaults to NOORM_PASSPHRASE env var) */
    passphrase?: string

    /** State directory name (defaults to '.noorm') */
    stateDir?: string

    /** State filename (defaults to 'state.enc') */
    stateFile?: string
}


/**
 * Manages encrypted state persistence.
 *
 * @example
 * ```typescript
 * const state = new StateManager(process.cwd())
 * await state.load()
 *
 * await state.setConfig('dev', { ... })
 * await state.setActiveConfig('dev')
 *
 * const config = state.getActiveConfig()
 * ```
 *
 * @example
 * ```typescript
 * // For testing with custom paths
 * const state = new StateManager('/tmp/test', {
 *     stateDir: '.test-noorm',
 *     stateFile: 'test-state.enc'
 * })
 * ```
 */
export class StateManager {

    private state: State | null = null
    private passphrase: string | undefined
    private statePath: string
    private loaded = false

    constructor(
        private readonly projectRoot: string,
        options: StateManagerOptions = {},
    ) {

        this.passphrase = options.passphrase ?? process.env['NOORM_PASSPHRASE']
        const stateDir = options.stateDir ?? DEFAULT_STATE_DIR
        const stateFile = options.stateFile ?? DEFAULT_STATE_FILE
        this.statePath = join(projectRoot, stateDir, stateFile)
    }

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    /**
     * Load state from disk. Creates empty state if file doesn't exist.
     * Applies migrations if state version differs from current package version.
     * Must be called before any other operations.
     */
    async load(): Promise<void> {

        if (this.loaded) return

        const currentVersion = getPackageVersion()

        if (!existsSync(this.statePath)) {

            this.state = createEmptyState(currentVersion)
            this.loaded = true
            observer.emit('state:loaded', {
                configCount: 0,
                activeConfig: null,
                version: currentVersion,
            })
            return
        }

        const [raw, readErr] = attemptSync(() => readFileSync(this.statePath, 'utf8'))
        if (readErr) {

            observer.emit('error', { source: 'state', error: readErr })
            throw readErr
        }

        const [payload, parseErr] = attemptSync(() => JSON.parse(raw!) as EncryptedPayload)
        if (parseErr) {

            observer.emit('error', { source: 'state', error: parseErr })
            throw new Error('Failed to parse state file. File may be corrupted.')
        }

        const [decrypted, decryptErr] = attemptSync(() => decrypt(payload!, this.passphrase))
        if (decryptErr) {

            observer.emit('error', { source: 'state', error: decryptErr })
            throw new Error('Failed to decrypt state. Wrong passphrase or corrupted file.')
        }

        const [parsedState, stateParseErr] = attemptSync(() => JSON.parse(decrypted!) as unknown)
        if (stateParseErr) {

            observer.emit('error', { source: 'state', error: stateParseErr })
            throw new Error('Failed to parse decrypted state.')
        }

        // Apply migrations if needed (migrateState emits state:migrated if version changed)
        const wasMigrated = needsMigration(parsedState, currentVersion)
        this.state = migrateState(parsedState, currentVersion)
        this.loaded = true

        // Persist if migrations were applied
        if (wasMigrated) {

            this.persist()
        }

        observer.emit('state:loaded', {
            configCount: Object.keys(this.state.configs).length,
            activeConfig: this.state.activeConfig,
            version: this.state.version,
        })
    }

    /**
     * Persist current state to disk (encrypted).
     */
    private persist(): void {

        const state = this.getState()

        const dir = dirname(this.statePath)
        if (!existsSync(dir)) {

            mkdirSync(dir, { recursive: true })
        }

        const json = JSON.stringify(state)
        const payload = encrypt(json, this.passphrase)

        const [, writeErr] = attemptSync(() =>
            writeFileSync(this.statePath, JSON.stringify(payload, null, 2))
        )

        if (writeErr) {

            observer.emit('error', { source: 'state', error: writeErr })
            throw writeErr
        }

        observer.emit('state:persisted', {
            configCount: Object.keys(state.configs).length
        })
    }

    /**
     * Get the loaded state, throwing if not loaded.
     */
    private getState(): State {

        if (!this.loaded || !this.state) {

            throw new Error('StateManager not loaded. Call load() first.')
        }
        return this.state
    }

    // ─────────────────────────────────────────────────────────────
    // Config Operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Get a config by name.
     */
    getConfig(name: string): Config | null {

        const state = this.getState()
        return state.configs[name] ?? null
    }

    /**
     * Set (create or update) a config.
     */
    async setConfig(name: string, config: Config): Promise<void> {

        const state = this.getState()
        const isNew = !state.configs[name]
        state.configs[name] = config
        this.persist()

        observer.emit(isNew ? 'config:created' : 'config:updated', {
            name,
            fields: Object.keys(config)
        })
    }

    /**
     * Delete a config and its secrets.
     */
    async deleteConfig(name: string): Promise<void> {

        const state = this.getState()
        delete state.configs[name]
        delete state.secrets[name]

        if (state.activeConfig === name) {

            state.activeConfig = null
        }

        this.persist()
        observer.emit('config:deleted', { name })
    }

    /**
     * List all configs with summary info.
     */
    listConfigs(): ConfigSummary[] {

        const state = this.getState()
        return Object.entries(state.configs).map(([name, config]) => ({
            name,
            type: config.type,
            isTest: config.isTest,
            protected: config.protected,
            isActive: state.activeConfig === name,
        }))
    }

    /**
     * Get the active config.
     */
    getActiveConfig(): Config | null {

        const state = this.getState()
        if (!state.activeConfig) return null
        return state.configs[state.activeConfig] ?? null
    }

    /**
     * Get the active config name.
     */
    getActiveConfigName(): string | null {

        const state = this.getState()
        return state.activeConfig
    }

    /**
     * Set the active config.
     */
    async setActiveConfig(name: string): Promise<void> {

        const state = this.getState()
        if (!state.configs[name]) {

            throw new Error(`Config "${name}" does not exist.`)
        }

        const previous = state.activeConfig
        state.activeConfig = name
        this.persist()

        observer.emit('config:activated', { name, previous })
    }

    // ─────────────────────────────────────────────────────────────
    // Secret Operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Get a secret value.
     */
    getSecret(configName: string, key: string): string | null {

        const state = this.getState()
        return state.secrets[configName]?.[key] ?? null
    }

    /**
     * Get all secrets for a config.
     */
    getAllSecrets(configName: string): Record<string, string> {

        const state = this.getState()
        return state.secrets[configName] ? { ...state.secrets[configName] } : {}
    }

    /**
     * Set a secret value.
     */
    async setSecret(configName: string, key: string, value: string): Promise<void> {

        const state = this.getState()

        if (!state.configs[configName]) {

            throw new Error(`Config "${configName}" does not exist.`)
        }

        if (!state.secrets[configName]) {

            state.secrets[configName] = {}
        }

        state.secrets[configName][key] = value
        this.persist()

        observer.emit('secret:set', { configName, key })
    }

    /**
     * Delete a secret.
     */
    async deleteSecret(configName: string, key: string): Promise<void> {

        const state = this.getState()

        if (state.secrets[configName]) {

            delete state.secrets[configName][key]
            this.persist()

            observer.emit('secret:deleted', { configName, key })
        }
    }

    /**
     * List all secret keys for a config (not values).
     */
    listSecrets(configName: string): string[] {

        const state = this.getState()
        return Object.keys(state.secrets[configName] ?? {})
    }

    // ─────────────────────────────────────────────────────────────
    // Global Secret Operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Get a global secret value (app-level, not config-specific).
     *
     * @example
     * ```typescript
     * const apiKey = state.getGlobalSecret('ANTHROPIC_API_KEY')
     * ```
     */
    getGlobalSecret(key: string): string | null {

        const state = this.getState()
        return state.globalSecrets[key] ?? null
    }

    /**
     * Get all global secrets.
     */
    getAllGlobalSecrets(): Record<string, string> {

        const state = this.getState()
        return { ...state.globalSecrets }
    }

    /**
     * Set a global secret value.
     *
     * @example
     * ```typescript
     * await state.setGlobalSecret('ANTHROPIC_API_KEY', 'sk-ant-...')
     * ```
     */
    async setGlobalSecret(key: string, value: string): Promise<void> {

        const state = this.getState()
        state.globalSecrets[key] = value
        this.persist()

        observer.emit('global-secret:set', { key })
    }

    /**
     * Delete a global secret.
     */
    async deleteGlobalSecret(key: string): Promise<void> {

        const state = this.getState()

        if (key in state.globalSecrets) {

            delete state.globalSecrets[key]
            this.persist()

            observer.emit('global-secret:deleted', { key })
        }
    }

    /**
     * List all global secret keys (not values).
     */
    listGlobalSecrets(): string[] {

        const state = this.getState()
        return Object.keys(state.globalSecrets)
    }

    // ─────────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────────

    /**
     * Get the current state version (package version).
     */
    getVersion(): string {

        const state = this.getState()
        return state.version
    }

    /**
     * Check if state file exists (before loading).
     */
    exists(): boolean {

        return existsSync(this.statePath)
    }

    /**
     * Get the path to the state file.
     */
    getStatePath(): string {

        return this.statePath
    }

    /**
     * Export state for backup (still encrypted).
     */
    exportEncrypted(): string | null {

        if (!existsSync(this.statePath)) return null
        return readFileSync(this.statePath, 'utf8')
    }

    /**
     * Import state from backup.
     */
    async importEncrypted(encrypted: string): Promise<void> {

        // Validate it can be decrypted first
        const [payload, parseErr] = attemptSync(() => JSON.parse(encrypted) as EncryptedPayload)
        if (parseErr) throw parseErr

        const [, decryptErr] = attemptSync(() => decrypt(payload!, this.passphrase))
        if (decryptErr) throw decryptErr

        const dir = dirname(this.statePath)
        if (!existsSync(dir)) {

            mkdirSync(dir, { recursive: true })
        }

        writeFileSync(this.statePath, encrypted)
        this.loaded = false
        await this.load()
    }
}
