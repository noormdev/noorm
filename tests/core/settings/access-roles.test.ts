import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager } from '../../../src/core/settings/manager.js';
import type { RoleDefinition } from '../../../src/core/settings/types.js';

describe('settings: access role persistence', () => {

    it('persists replacements, reloads inheritance and returns independent copies', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-role-'));
        try {

            const manager = new SettingsManager(root);
            await manager.load();
            await manager.setAccessRole('analyst', { extends: 'viewer', permissions: { 'sql:read': 'confirm', explore: 'deny' } });
            const copy = manager.getAccessRoles();
            copy['analyst']!.permissions!['sql:read'] = 'deny';
            expect(manager.getAccessRoles()['analyst']!.permissions!['sql:read']).toBe('confirm');
            await manager.setAccessRole('analyst', { extends: 'viewer', permissions: { explore: 'allow' } });
            await manager.setAccessRole('constructor', { extends: 'analyst' });
            await manager.setAccessRole('toString', { extends: 'viewer' });

            const reloaded = new SettingsManager(root);
            await reloaded.load();
            expect(reloaded.getAccessRoles()).toEqual({
                analyst: { extends: 'viewer', permissions: { explore: 'allow' } },
                constructor: { extends: 'analyst' },
                toString: { extends: 'viewer' },
            });
            expect(Object.hasOwn(reloaded.getAccessRoles(), 'constructor')).toBe(true);
            expect(await reloaded.removeAccessRole('constructor')).toBe(true);
            expect(await reloaded.removeAccessRole('constructor')).toBe(false);
            expect(Object.hasOwn(reloaded.getAccessRoles(), 'constructor')).toBe(false);
            expect(Object.hasOwn(reloaded.getAccessRoles(), 'toString')).toBe(true);
            expect(await reloaded.removeAccessRole('toString')).toBe(true);

        }
        finally {

            await rm(root, { recursive: true, force: true });

        }

    });

    it('resets built-ins but protects custom bases and validates candidates before saving', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-role-'));
        try {

            const manager = new SettingsManager(root);
            await manager.load();
            await manager.setAccessRole('viewer', { permissions: { 'sql:read': 'deny' } });
            await manager.setAccessRole('base', { extends: 'viewer' });
            await manager.setAccessRole('child', { extends: 'base' });
            expect(await manager.removeAccessRole('viewer')).toBe(true);
            expect(await manager.removeAccessRole('viewer')).toBe(false);
            await expect(manager.removeAccessRole('base')).rejects.toThrow();
            const before = await readFile(manager.settingsFilePath, 'utf8');
            const roles = manager.getAccessRoles();
            const invalid: Array<[string, RoleDefinition]> = [
                ['', {}],
                ['__proto__', {}],
                ['unknown', { extends: 'missing' }],
                ['base', { extends: 'child' }],
                ['admin', { extends: 'viewer' }],
                ['bad', { permissions: { nonsense: 'allow' } } as unknown as RoleDefinition],
                ['bad', { permissions: { explore: 'maybe' } } as unknown as RoleDefinition],
            ];
            for (const [name, definition] of invalid) {

                await expect(manager.setAccessRole(name, definition)).rejects.toThrow();
                expect(manager.getAccessRoles()).toEqual(roles);
                expect(await readFile(manager.settingsFilePath, 'utf8')).toBe(before);

            }
            await expect(manager.removeAccessRole('__proto__')).rejects.toThrow('cannot be persisted');
            expect(manager.getAccessRoles()).toEqual(roles);
            expect(await readFile(manager.settingsFilePath, 'utf8')).toBe(before);
            await manager.removeAccessRole('child');
            expect(await manager.removeAccessRole('base')).toBe(true);
            const reloaded = new SettingsManager(root);
            await reloaded.load();
            expect(reloaded.getAccessRoles()).toEqual({});

        }
        finally {

            await rm(root, { recursive: true, force: true });

        }

    });

    it('rolls back both in-memory views when saving fails', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-role-'));
        try {

            const manager = new SettingsManager(root);
            await manager.load();
            await manager.setAccessRole('analyst', { extends: 'viewer' });
            await rm(manager.settingsFilePath);
            await mkdir(manager.settingsFilePath);
            await expect(manager.setAccessRole('analyst', { extends: 'admin' })).rejects.toThrow();
            expect(manager.getAccessRoles()).toEqual({ analyst: { extends: 'viewer' } });
            expect(manager.settings.access?.roles?.['analyst']).toEqual({ extends: 'viewer' });
            await expect(manager.removeAccessRole('analyst')).rejects.toThrow();
            expect(manager.getAccessRoles()).toEqual({ analyst: { extends: 'viewer' } });

        }
        finally {

            await rm(root, { recursive: true, force: true });

        }

    });

    it('preserves document settings without persisting ambient overrides', async () => {

        const root = await mkdtemp(join(tmpdir(), 'noorm-role-'));
        const key = 'NOORM_PATHS_SQL';
        const previous = process.env[key];
        try {

            await mkdir(join(root, '.noorm'), { recursive: true });
            await writeFile(join(root, '.noorm', 'settings.yml'), 'paths:\n  sql: ./from-document\n');
            process.env[key] = './secret-env-path';
            const manager = new SettingsManager(root);
            await manager.load();
            expect(manager.getPaths().sql).toBe('./secret-env-path');
            await manager.setAccessRole('analyst', { extends: 'viewer' });
            const saved = await readFile(manager.settingsFilePath, 'utf8');
            expect(saved).toContain('./from-document');
            expect(saved).not.toContain('./secret-env-path');
            expect(manager.getAccessRoles()).toEqual({ analyst: { extends: 'viewer' } });

        }
        finally {

            if (previous === undefined) delete process.env[key];
            else process.env[key] = previous;
            await rm(root, { recursive: true, force: true });

        }

    });

});
