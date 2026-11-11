import { SSL_FIELD_PAIRS, type ConnectionConfig } from '../connection/types.js';

type Ssl = ConnectionConfig['ssl'];

/**
 * Combines the `ssl` of two layers.
 *
 * A deep merge would keep both the inline and file form of one field (`ca` and
 * `caFile`), so the higher layer's form of each field replaces the lower's.
 *
 * `rejectUnauthorized` is never inherited: a layer that sets `ssl` without it
 * validates, so a lower layer's `false` cannot weaken a higher layer's `ssl`.
 *
 * @example
 * combineSsl({ ca: 'PEM', rejectUnauthorized: false }, { caFile: './ca.pem' });
 * // { caFile: './ca.pem' }
 */
export function combineSsl(lower: Ssl, higher: Ssl): Ssl {

    if (higher === undefined) return lower;
    if (higher === false) return false;

    const { rejectUnauthorized: _dropped, ...inherited } = typeof lower === 'object' ? lower : {};

    if (higher === true) return Object.keys(inherited).length > 0 ? inherited : true;

    if (typeof lower !== 'object') return higher;

    for (const [inline, file] of SSL_FIELD_PAIRS) {

        if (higher[inline] === undefined && higher[file] === undefined) continue;

        delete inherited[inline];
        delete inherited[file];

    }

    return { ...inherited, ...higher };

}
