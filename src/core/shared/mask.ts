/**
 * Partial masking for a secret that is being shown to the person who owns it.
 *
 * The inspect screen exists to answer "did this template get the values I
 * think it got", and a row of `Object (7 keys)` cannot answer it. Neither can
 * a full reveal, which turns a screen someone leaves open during a screen
 * share into a credential leak. What answers it is enough of the value to
 * recognise which secret it is and to catch the two mistakes that actually
 * happen — a stale value, and a key resolved from the wrong tier.
 *
 * How much is safe to show depends on how much there is. A four-character
 * value has no middle to hide, so revealing its ends reveals the value; a
 * forty-character token gives away nothing in six characters. The bands below
 * reveal less as the value gets shorter, and stop revealing at all once a
 * value is short enough that any window is most of it.
 *
 * The mask core is a fixed width on purpose. Sizing it to the value would
 * publish the exact length of every secret on screen, which is a real
 * narrowing hint against a value someone is trying to guess. Callers that
 * want the length — inspect does, because "set but empty" and "set to the
 * 8-character staging password" are different bugs — ask for it separately
 * and render it as a number, where it reads as the diagnostic it is rather
 * than as part of the value.
 *
 * @example
 * maskSecret('hunter2');                          // 'h*****2'
 * maskSecret('postgres://user:pw@host/db');       // 'po*****t/db'
 */

/**
 * What stands in for the hidden middle, at every length that has one.
 *
 * Fixed rather than proportional so the rendering never encodes how long the
 * value is. See the module note.
 */
const MASK_CORE = '*****';

/**
 * Longest value that is shown as nothing but mask.
 *
 * At four characters a first-and-last window is half the value, which is not
 * a mask.
 */
const OPAQUE_MAX = 4;

/** Longest value that reveals only one character at each end. */
const NARROW_MAX = 8;

/** Longest value that reveals a suffix but no prefix. */
const SUFFIX_ONLY_MAX = 12;

/** What an empty value renders as, so it is not mistaken for an unset one. */
const EMPTY_LABEL = '(empty)';

/**
 * A secret rendered for display, revealing less the shorter it is.
 *
 * @example
 * maskSecret('');              // '(empty)'
 * maskSecret('abcd');          // '*****'
 * maskSecret('abcdefgh');      // 'a*****h'
 * maskSecret('abcdefghijkl');  // '*****ijkl'
 * maskSecret('abcdefghijklm'); // 'ab*****jklm'
 */
export function maskSecret(value: string): string {

    // Code points, not `.length`. A `String.prototype.slice` offset counts
    // UTF-16 code units, so a value ending in an emoji or any other non-BMP
    // character gets sliced through the middle of a surrogate pair and the
    // reveal renders as a replacement glyph — the one part of the value a
    // reader is meant to recognise, corrupted.
    const characters = [...value];
    const { length } = characters;

    const head = (count: number) => characters.slice(0, count).join('');
    const tail = (count: number) => characters.slice(-count).join('');

    if (length === 0) return EMPTY_LABEL;

    if (length <= OPAQUE_MAX) return MASK_CORE;

    if (length <= NARROW_MAX) return `${head(1)}${MASK_CORE}${tail(1)}`;

    if (length <= SUFFIX_ONLY_MAX) return `${MASK_CORE}${tail(4)}`;

    return `${head(2)}${MASK_CORE}${tail(4)}`;

}
