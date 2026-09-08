/**
 * maskSecret band tests.
 *
 * The bands exist so that the shorter a value is, the less of it a reader is
 * shown: a four-character secret has no middle to hide, so revealing its ends
 * would reveal the value. What is pinned here is how much of the input survives
 * each band, not how the asterisks look — widening a band fails these tests
 * even when the output still reads as masked, which is the point. A test that
 * only checked for the presence of a `*` would pass on a full reveal with one
 * asterisk appended.
 */
import { describe, it, expect } from 'bun:test';

import { maskSecret } from '../../../src/core/shared/mask.js';

/** Everything of the value that survived the mask, in order. */
function revealed(value: string): string {

    return maskSecret(value).replaceAll('*', '');

}

describe('core: maskSecret', () => {

    it('should distinguish a value that is set but empty from one that is masked', () => {

        expect(maskSecret('')).toBe('(empty)');

    });

    it('should reveal nothing of a value with no middle to hide', () => {

        for (const value of ['a', 'ab', 'abc', 'abcd']) {

            expect(maskSecret(value)).toBe('*****');
            expect(revealed(value)).toBe('');

        }

    });

    it('should reveal one character at each end from five through eight', () => {

        expect(maskSecret('abcde')).toBe('a*****e');
        expect(maskSecret('hunter2!')).toBe('h*****!');
        expect(revealed('hunter2!')).toHaveLength(2);

    });

    it('should reveal only a suffix from nine through twelve', () => {

        expect(maskSecret('abcdefghi')).toBe('*****fghi');
        expect(maskSecret('abcdefghijkl')).toBe('*****ijkl');
        expect(revealed('abcdefghijkl')).toHaveLength(4);

    });

    it('should reveal a short prefix and a suffix past twelve', () => {

        expect(maskSecret('abcdefghijklm')).toBe('ab*****jklm');
        expect(maskSecret('postgres://user:pw@host/db')).toBe('po*****t/db');

    });

    it('should reveal no more of a long value than of a barely-long one', () => {

        expect(revealed('x'.repeat(4096))).toHaveLength(6);
        expect(revealed('abcdefghijklm')).toHaveLength(6);

    });

    it('should leak no interior character, however recognisable', () => {

        const value = 'PREFIXsecretmiddleSUFFIX';

        expect(maskSecret(value)).toBe('PR*****FFIX');
        expect(maskSecret(value)).not.toContain('secretmiddle');

    });

    it('should never split a surrogate pair', () => {

        // `.slice` counts UTF-16 code units, so slicing a non-BMP character in
        // half yields a lone surrogate and the reveal renders as a replacement
        // glyph — corrupting the one part a reader is meant to recognise.
        const masked = maskSecret('🔥alpha-beta-gamma-omega🎉');

        expect(masked).toBe('🔥a*****ega🎉');

        // `for...of` walks code points, so a paired emoji arrives whole and a
        // broken one arrives as a bare surrogate in D800-DFFF.
        for (const character of masked) {

            const codePoint = character.codePointAt(0) ?? 0;

            expect(codePoint < 0xD800 || codePoint > 0xDFFF).toBe(true);

        }

    });

    it('should count bands in characters, not code units', () => {

        // Four emoji are eight code units. Counting units would put this in the
        // reveal-both-ends band, showing half of a four-character value.
        expect(maskSecret('🔥🎉🚀🌟')).toBe('*****');

    });

    it('should never encode the length in the width of the mask', () => {

        const short = maskSecret('abcdefghijklm');
        const long = maskSecret('abcdefghijklm'.repeat(20));

        expect(short.length).toBe(long.length);

    });

});
