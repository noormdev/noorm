/**
 * String utilities for CLI.
 */

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
