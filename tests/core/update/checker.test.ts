/**
 * Tests for version checker.
 *
 * Tests version parsing, comparison, and update detection.
 */
import { describe, it, expect } from 'vitest';

import {
    parsePrerelease,
    isMajorVersionUpdate,
    compareVersions,
} from '../../../src/core/update/checker.js';

describe('update: checker', () => {

    describe('parsePrerelease', () => {

        it('should parse alpha version', () => {

            const result = parsePrerelease('1.0.0-alpha.5');

            expect(result).toEqual({ channel: 'alpha', number: 5 });

        });

        it('should parse beta version', () => {

            const result = parsePrerelease('2.1.0-beta.12');

            expect(result).toEqual({ channel: 'beta', number: 12 });

        });

        it('should parse rc version', () => {

            const result = parsePrerelease('3.0.0-rc.1');

            expect(result).toEqual({ channel: 'rc', number: 1 });

        });

        it('should return null for stable version', () => {

            const result = parsePrerelease('1.0.0');

            expect(result).toBeNull();

        });

        it('should handle version without number suffix', () => {

            const result = parsePrerelease('1.0.0-dev');

            expect(result).toEqual({ channel: 'dev', number: 0 });

        });

        it('should handle complex prerelease identifiers', () => {

            const result = parsePrerelease('1.0.0-alpha');

            expect(result).toEqual({ channel: 'alpha', number: 0 });

        });

    });

    describe('isMajorVersionUpdate', () => {

        it('should detect major version bump', () => {

            expect(isMajorVersionUpdate('1.5.2', '2.0.0')).toBe(true);
            expect(isMajorVersionUpdate('1.0.0', '2.0.0')).toBe(true);
            expect(isMajorVersionUpdate('0.9.9', '1.0.0')).toBe(true);

        });

        it('should not flag minor version bump', () => {

            expect(isMajorVersionUpdate('1.5.2', '1.6.0')).toBe(false);
            expect(isMajorVersionUpdate('1.0.0', '1.1.0')).toBe(false);

        });

        it('should not flag patch version bump', () => {

            expect(isMajorVersionUpdate('1.5.2', '1.5.3')).toBe(false);
            expect(isMajorVersionUpdate('1.0.0', '1.0.1')).toBe(false);

        });

        it('should handle prerelease versions', () => {

            expect(isMajorVersionUpdate('1.0.0-alpha.1', '2.0.0')).toBe(true);
            expect(isMajorVersionUpdate('1.0.0', '2.0.0-alpha.1')).toBe(true);
            expect(isMajorVersionUpdate('1.0.0-alpha.1', '1.0.0')).toBe(false);

        });

    });

    describe('compareVersions', () => {

        describe('basic comparison', () => {

            it('should compare major versions', () => {

                expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
                expect(compareVersions('2.0.0', '1.0.0')).toBe(1);

            });

            it('should compare minor versions', () => {

                expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
                expect(compareVersions('1.2.0', '1.1.0')).toBe(1);

            });

            it('should compare patch versions', () => {

                expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
                expect(compareVersions('1.0.2', '1.0.1')).toBe(1);

            });

            it('should identify equal versions', () => {

                expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
                expect(compareVersions('2.5.3', '2.5.3')).toBe(0);

            });

        });

        describe('prerelease comparison', () => {

            it('should rank stable higher than prerelease', () => {

                expect(compareVersions('1.0.0', '1.0.0-alpha.1')).toBe(1);
                expect(compareVersions('1.0.0-alpha.1', '1.0.0')).toBe(-1);

            });

            it('should compare prerelease channels', () => {

                // alpha < beta < rc
                expect(compareVersions('1.0.0-alpha.1', '1.0.0-beta.1')).toBe(-1);
                expect(compareVersions('1.0.0-beta.1', '1.0.0-rc.1')).toBe(-1);
                expect(compareVersions('1.0.0-rc.1', '1.0.0-alpha.1')).toBe(1);

            });

            it('should compare prerelease numbers within same channel', () => {

                expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
                expect(compareVersions('1.0.0-alpha.5', '1.0.0-alpha.3')).toBe(1);
                expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.1')).toBe(0);

            });

            it('should compare equal prerelease versions', () => {

                expect(compareVersions('1.0.0-beta.5', '1.0.0-beta.5')).toBe(0);

            });

        });

        describe('edge cases', () => {

            it('should handle versions with different prerelease suffixes', () => {

                // Different base versions with prerelease
                expect(compareVersions('2.0.0-alpha.1', '1.0.0')).toBe(1);
                expect(compareVersions('1.0.0-alpha.1', '2.0.0')).toBe(-1);

            });

            it('should handle dev versions', () => {

                expect(compareVersions('0.0.0-dev', '1.0.0')).toBe(-1);
                expect(compareVersions('1.0.0', '0.0.0-dev')).toBe(1);

            });

        });

    });

});
