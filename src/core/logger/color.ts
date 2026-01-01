/**
 * Color Formatter
 *
 * Formats log entries with ANSI colors for console output.
 * Flattens data one level deep - nested objects are stringified.
 */
import c from 'ansi-colors';

import type { EntryLevel } from './types.js';

/**
 * Level icons and colors.
 */
const LEVEL_STYLE: Record<EntryLevel, { icon: string; color: (s: string) => string }> = {
    error: { icon: '✗', color: c.red },
    warn: { icon: '⚠', color: c.yellow },
    info: { icon: '•', color: c.cyan },
    debug: { icon: '○', color: c.dim },
};

/**
 * Format a value for single-line display.
 *
 * Primitives are displayed directly, objects are stringified.
 */
function formatValue(value: unknown): string {

    if (value === null) {

        return c.dim('null');

    }

    if (value === undefined) {

        return c.dim('undefined');

    }

    if (typeof value === 'string') {

        return value.length > 50 ? `"${value.slice(0, 47)}..."` : value;

    }

    if (typeof value === 'number') {

        return c.yellow(String(value));

    }

    if (typeof value === 'boolean') {

        return c.magenta(String(value));

    }

    if (value instanceof Date) {

        return c.dim(value.toISOString());

    }

    if (value instanceof Error) {

        return c.red(value.message);

    }

    if (Array.isArray(value)) {

        if (value.length === 0) {

            return c.dim('[]');

        }

        if (value.length <= 3 && value.every((v) => typeof v === 'string' || typeof v === 'number')) {

            return `[${value.join(', ')}]`;

        }

        return c.dim(`[${value.length} items]`);

    }

    if (typeof value === 'object') {

        // Stringify nested objects
        try {

            const str = JSON.stringify(value);

            return str.length > 60 ? str.slice(0, 57) + '...' : str;

        }
        catch {

            return c.dim('[object]');

        }

    }

    return String(value);

}

/**
 * Flatten data to key=value pairs, one level deep.
 */
function flattenData(data: Record<string, unknown>): string {

    const pairs: string[] = [];

    for (const [key, value] of Object.entries(data)) {

        pairs.push(`${c.dim(key)}=${formatValue(value)}`);

    }

    return pairs.join(' ');

}

/**
 * Format a log entry as a colored line.
 *
 * Format: `[icon] event  key=value key=value ...`
 *
 * @param level - Entry severity level
 * @param event - Observer event name
 * @param message - Human-readable message
 * @param data - Event payload (flattened one level deep)
 * @returns Colored line string (no newline)
 */
export function formatColorLine(
    level: EntryLevel,
    event: string,
    message: string,
    data?: Record<string, unknown>,
): string {

    const style = LEVEL_STYLE[level];
    const icon = style.color(style.icon);
    const eventStr = style.color(event);

    let line = `${icon} ${eventStr}  ${message}`;

    if (data && Object.keys(data).length > 0) {

        line += `  ${flattenData(data)}`;

    }

    return line;

}

/**
 * Status icons for common result types.
 */
export const STATUS_ICONS = {
    success: c.green('✓'),
    failed: c.red('✗'),
    partial: c.yellow('⚠'),
    pending: c.yellow('○'),
    skipped: c.dim('○'),
    reverted: c.blue('↩'),
} as const;

/**
 * Format duration for display.
 */
export function formatDuration(ms: number): string {

    return c.dim(`(${ms}ms)`);

}
