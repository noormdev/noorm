import { describe, it, expect } from 'bun:test';
import { attemptSync } from '@logosdx/utils';

import { combineSsl } from '../../../src/core/config/ssl-combine.js';
import { validateConfigInput } from '../../../src/core/config/schema.js';

describe('config: combineSsl', () => {

    it('false over anything is false', () => {

        for (const lower of [undefined, true, false, { caFile: './ca.pem' }, { rejectUnauthorized: false }]) {

            expect(combineSsl(lower, false)).toBe(false);

        }

    });

    it('true over nothing, false or true is true', () => {

        for (const lower of [undefined, false, true]) {

            expect(combineSsl(lower, true)).toBe(true);

        }

    });

    it('true over an object keeps the certificate fields and drops the lower rejectUnauthorized', () => {

        expect(combineSsl({ caFile: './ca.pem', rejectUnauthorized: false }, true))
            .toEqual({ caFile: './ca.pem' });
        expect(combineSsl({ ca: 'PEM', certFile: './c.pem', key: 'KEY', rejectUnauthorized: true }, true))
            .toEqual({ ca: 'PEM', certFile: './c.pem', key: 'KEY' });

    });

    it('true over an object holding nothing but rejectUnauthorized is true', () => {

        expect(combineSsl({ rejectUnauthorized: false }, true)).toBe(true);
        expect(combineSsl({}, true)).toBe(true);

    });

    it('an object over an object replaces each of ca, cert and key by the higher layer\'s form, inline or file', () => {

        const lower = { ca: 'LOWER-CA', certFile: './c.pem', key: 'LOWER-KEY' };
        const higher = { caFile: './ca.pem', cert: 'HIGHER-CERT' };

        expect(combineSsl(lower, higher)).toEqual({
            caFile: './ca.pem',
            cert: 'HIGHER-CERT',
            key: 'LOWER-KEY',
        });

    });

    it('an object over an object takes rejectUnauthorized from the higher object only', () => {

        const lower = { ca: 'LOWER-CA', rejectUnauthorized: false };

        expect(combineSsl(lower, { certFile: './c.pem' })).toEqual({ ca: 'LOWER-CA', certFile: './c.pem' });
        expect(combineSsl(lower, { rejectUnauthorized: true })).toEqual({ ca: 'LOWER-CA', rejectUnauthorized: true });
        expect(combineSsl({ ca: 'LOWER-CA', rejectUnauthorized: true }, { rejectUnauthorized: false }))
            .toEqual({ ca: 'LOWER-CA', rejectUnauthorized: false });
        expect(combineSsl({ caFile: './ca.pem' }, { rejectUnauthorized: true, certFile: './c.pem' }))
            .toEqual({ caFile: './ca.pem', certFile: './c.pem', rejectUnauthorized: true });

    });

    it('an object over nothing, true or false is that object', () => {

        const higher = { rejectUnauthorized: false };

        expect(combineSsl(undefined, higher)).toEqual(higher);
        expect(combineSsl(true, higher)).toEqual(higher);
        expect(combineSsl(false, higher)).toEqual(higher);

    });

    it('an undefined higher layer leaves the lower layer whole, rejectUnauthorized included', () => {

        for (const lower of [{ rejectUnauthorized: false }, { ca: 'PEM', rejectUnauthorized: false }, true, false]) {

            expect(combineSsl(lower, undefined)).toEqual(lower);

        }

        expect(combineSsl(undefined, undefined)).toBeUndefined();

    });

    it('neither argument is mutated', () => {

        const lower = { ca: 'LOWER-CA', certFile: './c.pem', rejectUnauthorized: false };
        const higher = { caFile: './ca.pem', cert: 'CERT' };

        combineSsl(lower, higher);
        combineSsl(lower, true);

        expect(lower).toEqual({ ca: 'LOWER-CA', certFile: './c.pem', rejectUnauthorized: false });
        expect(higher).toEqual({ caFile: './ca.pem', cert: 'CERT' });

    });

    it('after combining valid layers, no inline and file pair of one field remains', () => {

        const combined = combineSsl({ ca: 'PEM', certFile: './c.pem' }, { caFile: './ca.pem', cert: 'CERT' });
        const [, err] = attemptSync(() => validateConfigInput({ connection: { ssl: combined } }));

        expect(err).toBeNull();

    });

});
