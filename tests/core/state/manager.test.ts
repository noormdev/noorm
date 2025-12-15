/**
 * StateManager tests.
 *
 * Uses a local tmp/ folder with custom state paths to avoid
 * polluting the project directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { StateManager, resetStateManager } from '../../../src/core/state/index.js'
import type { Config } from '../../../src/core/config/types.js'


/**
 * Create a valid test config.
 */
function createTestConfig(name: string, overrides: Partial<Config> = {}): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        protected: false,
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
        paths: {
            schema: './schema',
            changesets: './changesets',
        },
        ...overrides,
    }
}


describe('StateManager', () => {

    let tempDir: string
    let state: StateManager

    beforeEach(() => {

        resetStateManager()
        // Create temp directory in local tmp/ folder
        tempDir = mkdtempSync(join(process.cwd(), 'tmp', 'noorm-test-'))
        state = new StateManager(tempDir, {
            stateDir: '.test-state',
            stateFile: 'state.enc',
        })
    })

    afterEach(() => {

        if (existsSync(tempDir)) {

            rmSync(tempDir, { recursive: true })
        }
    })

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    describe('lifecycle', () => {

        it('should start with empty state when no file exists', async () => {

            await state.load()

            expect(state.listConfigs()).toEqual([])
            expect(state.getActiveConfig()).toBeNull()
            expect(state.getActiveConfigName()).toBeNull()
        })

        it('should throw if methods called before load()', () => {

            expect(() => state.listConfigs()).toThrow('StateManager not loaded')
            expect(() => state.getConfig('test')).toThrow('StateManager not loaded')
            expect(() => state.getActiveConfig()).toThrow('StateManager not loaded')
        })

        it('should create state file on first persist', async () => {

            await state.load()
            await state.setConfig('test', createTestConfig('test'))

            const statePath = state.getStatePath()
            expect(existsSync(statePath)).toBe(true)
        })

        it('should report exists() correctly', async () => {

            expect(state.exists()).toBe(false)

            await state.load()
            await state.setConfig('test', createTestConfig('test'))

            expect(state.exists()).toBe(true)
        })
    })

    // ─────────────────────────────────────────────────────────────
    // Config Operations
    // ─────────────────────────────────────────────────────────────

    describe('config operations', () => {

        beforeEach(async () => {

            await state.load()
        })

        it('should create and retrieve a config', async () => {

            const config = createTestConfig('dev')
            await state.setConfig('dev', config)

            const retrieved = state.getConfig('dev')
            expect(retrieved).toEqual(config)
        })

        it('should return null for non-existent config', () => {

            const config = state.getConfig('nonexistent')
            expect(config).toBeNull()
        })

        it('should update existing config', async () => {

            await state.setConfig('dev', createTestConfig('dev'))
            await state.setConfig('dev', createTestConfig('dev', { protected: true }))

            const config = state.getConfig('dev')
            expect(config?.protected).toBe(true)
        })

        it('should delete a config', async () => {

            await state.setConfig('dev', createTestConfig('dev'))
            await state.deleteConfig('dev')

            expect(state.getConfig('dev')).toBeNull()
        })

        it('should list all configs', async () => {

            // Start with known clean state
            const initialCount = state.listConfigs().length

            await state.setConfig('dev', createTestConfig('dev'))
            await state.setConfig('prod', createTestConfig('prod', { protected: true }))

            const list = state.listConfigs()
            expect(list).toHaveLength(initialCount + 2)
            expect(list.find(c => c.name === 'dev')).toBeDefined()
            expect(list.find(c => c.name === 'prod')?.protected).toBe(true)
        })

        it('should set and get active config', async () => {

            await state.setConfig('dev', createTestConfig('dev'))
            await state.setActiveConfig('dev')

            expect(state.getActiveConfigName()).toBe('dev')
            expect(state.getActiveConfig()?.name).toBe('dev')
        })

        it('should throw when setting non-existent config as active', async () => {

            await expect(state.setActiveConfig('nonexistent'))
                .rejects.toThrow('does not exist')
        })

        it('should clear active config when deleted', async () => {

            await state.setConfig('dev', createTestConfig('dev'))
            await state.setActiveConfig('dev')
            await state.deleteConfig('dev')

            expect(state.getActiveConfigName()).toBeNull()
        })
    })

    // ─────────────────────────────────────────────────────────────
    // Secret Operations
    // ─────────────────────────────────────────────────────────────

    describe('secret operations', () => {

        beforeEach(async () => {

            await state.load()
            await state.setConfig('dev', createTestConfig('dev'))
        })

        it('should set and get a secret', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret-value')

            const secret = state.getSecret('dev', 'API_KEY')
            expect(secret).toBe('secret-value')
        })

        it('should return null for non-existent secret', () => {

            const secret = state.getSecret('dev', 'NONEXISTENT')
            expect(secret).toBeNull()
        })

        it('should throw when setting secret on non-existent config', async () => {

            await expect(state.setSecret('nonexistent', 'KEY', 'value'))
                .rejects.toThrow('does not exist')
        })

        it('should list secret keys without values', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret1')
            await state.setSecret('dev', 'DB_PASSWORD', 'secret2')

            const keys = state.listSecrets('dev')
            expect(keys).toContain('API_KEY')
            expect(keys).toContain('DB_PASSWORD')
            expect(keys).not.toContain('secret1')
        })

        it('should get all secrets for a config', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret1')
            await state.setSecret('dev', 'DB_PASSWORD', 'secret2')

            const secrets = state.getAllSecrets('dev')
            expect(secrets).toEqual({
                API_KEY: 'secret1',
                DB_PASSWORD: 'secret2',
            })
        })

        it('should delete a secret', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret-value')
            await state.deleteSecret('dev', 'API_KEY')

            expect(state.getSecret('dev', 'API_KEY')).toBeNull()
        })

        it('should delete secrets when config is deleted', async () => {

            await state.setSecret('dev', 'API_KEY', 'secret-value')
            await state.deleteConfig('dev')

            // Re-create config to check secrets are gone
            await state.setConfig('dev', createTestConfig('dev'))
            expect(state.getSecret('dev', 'API_KEY')).toBeNull()
        })
    })

    // ─────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────

    describe('persistence', () => {

        it('should persist and reload state', async () => {

            await state.load()
            await state.setConfig('dev', createTestConfig('dev'))
            await state.setActiveConfig('dev')
            await state.setSecret('dev', 'API_KEY', 'test-secret')

            // Create new instance pointing to same location
            const state2 = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state.enc',
            })
            await state2.load()

            expect(state2.getConfig('dev')?.name).toBe('dev')
            expect(state2.getActiveConfigName()).toBe('dev')
            expect(state2.getSecret('dev', 'API_KEY')).toBe('test-secret')
        })

        it('should work with passphrase', async () => {

            const stateWithPass = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-pass.enc',
                passphrase: 'test-passphrase',
            })
            await stateWithPass.load()
            await stateWithPass.setConfig('dev', createTestConfig('dev'))

            // Same passphrase should work
            const state2 = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-pass.enc',
                passphrase: 'test-passphrase',
            })
            await state2.load()
            expect(state2.getConfig('dev')?.name).toBe('dev')
        })

        it('should fail with wrong passphrase', async () => {

            const stateWithPass = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-pass2.enc',
                passphrase: 'correct-passphrase',
            })
            await stateWithPass.load()
            await stateWithPass.setConfig('dev', createTestConfig('dev'))

            // Wrong passphrase should fail
            const wrongState = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'state-pass2.enc',
                passphrase: 'wrong-passphrase',
            })
            await expect(wrongState.load()).rejects.toThrow('Failed to decrypt')
        })
    })

    // ─────────────────────────────────────────────────────────────
    // Import/Export
    // ─────────────────────────────────────────────────────────────

    describe('import/export', () => {

        it('should export encrypted state', async () => {

            await state.load()
            await state.setConfig('dev', createTestConfig('dev'))

            const exported = state.exportEncrypted()
            expect(exported).not.toBeNull()
            expect(typeof exported).toBe('string')

            // Should be valid JSON
            const parsed = JSON.parse(exported!)
            expect(parsed.version).toBe(1)
            expect(parsed.algorithm).toBe('aes-256-gcm')
        })

        it('should return null when exporting non-existent state', async () => {

            const exported = state.exportEncrypted()
            expect(exported).toBeNull()
        })

        it('should import encrypted state', async () => {

            // Create and export state
            await state.load()
            await state.setConfig('dev', createTestConfig('dev'))
            const exported = state.exportEncrypted()!

            // Create new state and import
            const newState = new StateManager(tempDir, {
                stateDir: '.test-state',
                stateFile: 'imported.enc',
            })
            await newState.importEncrypted(exported)

            expect(newState.getConfig('dev')?.name).toBe('dev')
        })
    })
})
