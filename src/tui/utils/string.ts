/**
 * String utilities for CLI.
 */

/**
 * Flatten text to a single line.
 *
 * `wrap="truncate"` bounds a `<Text>`'s width and not its height: Ink still
 * breaks on an embedded newline, so one row of a windowed list silently becomes
 * three and the fold is wrong by two for everything below it. Anything drawn
 * into a counted row — a secret, an environment value, a database error, a
 * stack trace — goes through here first.
 *
 * @example
 * oneLine('Unexpected token\n  at line 3'); // 'Unexpected token   at line 3'
 */
export function oneLine(text: string): string {

    return text.replace(/[\r\n]+/g, ' ');

}

/**
 * Converts a sentence or phrase to kebab-case.
 *
 * Handles natural language input by:
 * - Replacing non-alphanumeric characters with spaces
 * - Collapsing multiple spaces
 * - Lowercasing everything
 * - Converting spaces to hyphens
 * - Removing leading/trailing hyphens
 * - Collapsing multiple hyphens
 *
 * @example
 * toKebabCase('Add User Authentication')     // 'add-user-authentication'
 * toKebabCase('Fix the bug -- important!')   // 'fix-the-bug-important'
 * toKebabCase('  Multiple   Spaces  ')       // 'multiple-spaces'
 * toKebabCase('Special@#$Characters!')       // 'special-characters'
 */
export function toKebabCase(input: string): string {

    return input
        // Replace non-alphanumeric with spaces
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        // Trim and collapse multiple spaces
        .trim()
        .replace(/\s+/g, ' ')
        // Lowercase
        .toLowerCase()
        // Spaces to hyphens
        .replace(/\s/g, '-')
        // Collapse multiple hyphens (shouldn't happen but safety)
        .replace(/-+/g, '-')
        // Remove leading/trailing hyphens
        .replace(/^-|-$/g, '');

}
