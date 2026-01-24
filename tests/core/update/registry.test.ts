/**
 * Tests for NPM registry client.
 *
 * Tests fetching package info and version utilities.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    fetchPackageInfo,
    getLatestForChannel,
    getVersionsOnChannel,
    type RegistryPackageInfo,
} from '../../../src/core/update/registry.js';

describe('update: registry', () => {

    beforeEach(() => {

        vi.stubGlobal('fetch', vi.fn());

    });

    afterEach(() => {

        vi.unstubAllGlobals();

    });

    describe('fetchPackageInfo', () => {

        it('should return package info on success', async () => {

            const mockPackageInfo: RegistryPackageInfo = {
                'dist-tags': { latest: '1.2.0', alpha: '1.3.0-alpha.1' },
                versions: { '1.0.0': {}, '1.1.0': {}, '1.2.0': {} },
                time: {},
            };

            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockPackageInfo),
            } as Response);

            const info = await fetchPackageInfo();

            expect(info).not.toBeNull();
            expect(info?.['dist-tags'].latest).toBe('1.2.0');

        });

        it('should return null on network error', async () => {

            vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

            const info = await fetchPackageInfo();

            expect(info).toBeNull();

        });

        it('should return null on HTTP error', async () => {

            vi.mocked(fetch).mockResolvedValue({
                ok: false,
                status: 404,
            } as Response);

            const info = await fetchPackageInfo();

            expect(info).toBeNull();

        });

        it('should return null on invalid JSON', async () => {

            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: () => Promise.reject(new SyntaxError('Invalid JSON')),
            } as Response);

            const info = await fetchPackageInfo();

            expect(info).toBeNull();

        });

        it('should use AbortController for timeout', async () => {

            let capturedSignal: AbortSignal | undefined;

            vi.mocked(fetch).mockImplementation(async (_url, options) => {

                capturedSignal = options?.signal;

                return {
                    ok: true,
                    json: () => Promise.resolve({
                        'dist-tags': { latest: '1.0.0' },
                        versions: {},
                        time: {},
                    }),
                } as Response;

            });

            await fetchPackageInfo();

            expect(capturedSignal).toBeDefined();
            expect(capturedSignal).toBeInstanceOf(AbortSignal);

        });

    });

    describe('getLatestForChannel', () => {

        const mockInfo: RegistryPackageInfo = {
            'dist-tags': {
                latest: '1.2.0',
                alpha: '1.3.0-alpha.5',
                beta: '1.3.0-beta.2',
            },
            versions: {},
            time: {},
        };

        it('should return latest version for default channel', () => {

            const version = getLatestForChannel(mockInfo);

            expect(version).toBe('1.2.0');

        });

        it('should return version for specific channel', () => {

            expect(getLatestForChannel(mockInfo, 'alpha')).toBe('1.3.0-alpha.5');
            expect(getLatestForChannel(mockInfo, 'beta')).toBe('1.3.0-beta.2');

        });

        it('should return null for unknown channel', () => {

            const version = getLatestForChannel(mockInfo, 'nonexistent');

            expect(version).toBeNull();

        });

    });

    describe('getVersionsOnChannel', () => {

        const mockInfo: RegistryPackageInfo = {
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '1.0.0': {},
                '1.0.0-alpha.1': {},
                '1.0.0-alpha.2': {},
                '1.0.0-alpha.10': {},
                '1.1.0-alpha.1': {},
                '1.0.0-beta.1': {},
                '1.1.0': {},
            },
            time: {},
        };

        it('should filter versions by channel', () => {

            const alphaVersions = getVersionsOnChannel(mockInfo, 'alpha');

            expect(alphaVersions).toContain('1.0.0-alpha.1');
            expect(alphaVersions).toContain('1.0.0-alpha.2');
            expect(alphaVersions).toContain('1.1.0-alpha.1');
            expect(alphaVersions).not.toContain('1.0.0');
            expect(alphaVersions).not.toContain('1.0.0-beta.1');

        });

        it('should sort versions ascending', () => {

            const alphaVersions = getVersionsOnChannel(mockInfo, 'alpha');

            // Should be sorted by base version, then prerelease number
            expect(alphaVersions.indexOf('1.0.0-alpha.1')).toBeLessThan(
                alphaVersions.indexOf('1.0.0-alpha.2'),
            );
            expect(alphaVersions.indexOf('1.0.0-alpha.2')).toBeLessThan(
                alphaVersions.indexOf('1.0.0-alpha.10'),
            );
            expect(alphaVersions.indexOf('1.0.0-alpha.10')).toBeLessThan(
                alphaVersions.indexOf('1.1.0-alpha.1'),
            );

        });

        it('should return empty array for no matches', () => {

            const rcVersions = getVersionsOnChannel(mockInfo, 'rc');

            expect(rcVersions).toEqual([]);

        });

    });

});
