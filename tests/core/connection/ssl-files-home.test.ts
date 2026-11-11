/** `~/` expansion against a real HOME: `homedir()` is fixed per process, so a child started with HOME set is the only proof. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createThrowawayHome, type ThrowawayHome } from '../../cli/fixtures/throwaway-home.js';

const CHILD = join(import.meta.dir, 'fixtures', 'ssl-home-child.ts');

describe('connection: resolveSslFiles ~/ expansion', () => {

    let home: ThrowawayHome;
    let homeDir: string;

    beforeEach(async () => {

        home = await createThrowawayHome();
        homeDir = dirname(home.noormHome);

    });

    afterEach(async () => {

        await home.remove();

    });

    it('should expand a leading ~/ to the home directory', async () => {

        const ca = '-----BEGIN CERTIFICATE-----\nthrowaway-ca\n-----END CERTIFICATE-----\n';

        await writeFile(join(homeDir, 'ca.pem'), ca);

        expect(JSON.parse(home.run(CHILD, '~/ca.pem'))).toEqual({ ssl: { ca } });

    });

    it('should report the expanded path when a ~/ file is missing', () => {

        expect(JSON.parse(home.run(CHILD, '~/missing.pem'))).toEqual({
            code: 'ENOENT',
            path: join(homeDir, 'missing.pem'),
        });

    });

});
