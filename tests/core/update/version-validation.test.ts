import { describe, it, expect } from 'bun:test';

import { attempt, attemptSync } from '@logosdx/utils';

import { isValidVersion, InvalidVersionError } from '../../../src/core/update/checker.js';
import { getBinaryDownloadUrl, getChecksumsUrl } from '../../../src/core/update/install-mode.js';
import { installUpdate } from '../../../src/core/update/updater.js';

/**
 * The exact payloads the A11 audit proved were accepted verbatim from npm
 * `dist-tags.latest`. The traversal one is the reachable defect: `fetch`
 * normalises `..`, so it relocated BOTH the binary and its checksums.txt to
 * an attacker repo, making checksum verification pass against the attacker's
 * own file.
 */
const TRAVERSAL_PAYLOAD = '1.0.0/../../../../../evil-org/evil-repo/releases/download/v1';
const SHELL_PAYLOAD = '99.0.0; touch /tmp/pwned';

describe('update: version validation', () => {

    describe('isValidVersion', () => {

        it('should accept the versions this project actually publishes', () => {

            expect(isValidVersion('1.0.0')).toBe(true);
            expect(isValidVersion('1.0.0-alpha.39')).toBe(true);
            expect(isValidVersion('2.10.3-beta.1')).toBe(true);
            expect(isValidVersion('0.0.0-dev')).toBe(true);

        });

        it('should reject a version carrying shell metacharacters', () => {

            expect(isValidVersion(SHELL_PAYLOAD)).toBe(false);

        });

        it('should reject a version carrying path traversal', () => {

            expect(isValidVersion(TRAVERSAL_PAYLOAD)).toBe(false);

        });

        it('should reject junk that loose parsing would still compare as greater', () => {

            expect(isValidVersion('99.0.0 && rm -rf /')).toBe(false);
            expect(isValidVersion('../../etc/passwd')).toBe(false);
            expect(isValidVersion('1.0.0\nlatest')).toBe(false);
            expect(isValidVersion('')).toBe(false);
            expect(isValidVersion('latest')).toBe(false);

        });

    });

    describe('getBinaryDownloadUrl', () => {

        it('should build the release URL for a valid version', () => {

            const url = getBinaryDownloadUrl('1.0.0-alpha.39');

            expect(url).toContain('https://github.com/noormdev/noorm/releases/download/');
            expect(url).toContain('1.0.0-alpha.39');

        });

        it('should refuse to build a URL that escapes the noorm release repo', () => {

            const [url, err] = attemptSync(() => getBinaryDownloadUrl(TRAVERSAL_PAYLOAD));

            expect(err).toBeInstanceOf(InvalidVersionError);
            expect(url).toBeNull();

        });

    });

    describe('getChecksumsUrl', () => {

        /**
         * The checksums URL is the one that matters most: if a poisoned version
         * can move it, verification is checking the binary against a file the
         * same attacker wrote, and passes.
         */
        it('should refuse to relocate checksums.txt to another repo', () => {

            const [url, err] = attemptSync(() => getChecksumsUrl(TRAVERSAL_PAYLOAD));

            expect(err).toBeInstanceOf(InvalidVersionError);
            expect(url).toBeNull();

        });

    });

    describe('installUpdate', () => {

        it('should refuse an invalid version instead of downloading or spawning', async () => {

            const [result, err] = await attempt(() => installUpdate(SHELL_PAYLOAD));

            expect(err).toBeNull();
            expect(result?.success).toBe(false);
            expect(result?.error).toContain('version');

        });

        it('should refuse a traversal version before any URL is built', async () => {

            const [result, err] = await attempt(() => installUpdate(TRAVERSAL_PAYLOAD));

            expect(err).toBeNull();
            expect(result?.success).toBe(false);
            expect(result?.error).toContain('version');

        });

    });

});
