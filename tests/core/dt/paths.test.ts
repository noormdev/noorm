/**
 * Tests for export path resolution utilities.
 */
import { describe, it, expect } from 'vitest';

import {
    resolveExportExtension,
    resolveExportPath,
} from '../../../src/core/dt/paths.js';

describe('resolveExportExtension', () => {

    it('returns .dt by default', () => {

        expect(resolveExportExtension(false)).toBe('.dt');

    });

    it('returns .dtz when compress is true', () => {

        expect(resolveExportExtension(true)).toBe('.dtz');

    });

    it('returns .dtzx when passphrase is provided', () => {

        expect(resolveExportExtension(false, 'secret')).toBe('.dtzx');
        expect(resolveExportExtension(true, 'secret')).toBe('.dtzx');

    });

    it('passphrase takes precedence over compress', () => {

        // Even with compress=false, passphrase wins
        expect(resolveExportExtension(false, 'secret')).toBe('.dtzx');

    });

});

describe('resolveExportPath', () => {

    describe('single table', () => {

        it('uses path as-is when it has a recognized extension', () => {

            expect(resolveExportPath({
                exportPath: './backup/users.dt',
                tableName: 'users',
                tableCount: 1,
                ext: '.dt',
            })).toBe('./backup/users.dt');

            expect(resolveExportPath({
                exportPath: './backup/users.dtz',
                tableName: 'users',
                tableCount: 1,
                ext: '.dtz',
            })).toBe('./backup/users.dtz');

            expect(resolveExportPath({
                exportPath: './backup/users.dtzx',
                tableName: 'users',
                tableCount: 1,
                ext: '.dtzx',
            })).toBe('./backup/users.dtzx');

        });

        it('appends extension when path has no recognized extension', () => {

            expect(resolveExportPath({
                exportPath: './backup/users',
                tableName: 'users',
                tableCount: 1,
                ext: '.dt',
            })).toBe('./backup/users.dt');

            expect(resolveExportPath({
                exportPath: './backup/users',
                tableName: 'users',
                tableCount: 1,
                ext: '.dtz',
            })).toBe('./backup/users.dtz');

        });

        it('keeps other extensions and appends', () => {

            // If someone specifies a weird extension, we append
            expect(resolveExportPath({
                exportPath: './backup/users.json',
                tableName: 'users',
                tableCount: 1,
                ext: '.dt',
            })).toBe('./backup/users.json.dt');

        });

    });

    describe('multiple tables', () => {

        it('treats path as directory and generates filename', () => {

            expect(resolveExportPath({
                exportPath: './backup/',
                tableName: 'users',
                tableCount: 3,
                ext: '.dt',
            })).toBe('backup/users.dt');

            expect(resolveExportPath({
                exportPath: './backup/',
                tableName: 'posts',
                tableCount: 3,
                ext: '.dtz',
            })).toBe('backup/posts.dtz');

        });

        it('works with directories without trailing slash', () => {

            expect(resolveExportPath({
                exportPath: './backup',
                tableName: 'users',
                tableCount: 3,
                ext: '.dt',
            })).toBe('backup/users.dt');

        });

    });

});
