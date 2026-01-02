/**
 * Color Formatter
 *
 * Formats log entries with ANSI colors for console output.
 * Uses the centralized theme for consistent styling with truecolor support.
 * Flattens data one level deep - nested objects are stringified.
 */
import ansis from 'ansis';
import { attemptSync } from '@logosdx/utils';

import type { EntryLevel } from './types.js';
import {
    theme,
    logLevelColors,
    logLevelIcons,
    data as dataFormatters,
} from '../theme.js';

/**
 * Level icons and colors from theme.
 */
const LEVEL_STYLE: Record<EntryLevel, { icon: string; color: (s: string) => string }> = {
    error: { icon: logLevelIcons.error, color: logLevelColors.error },
    warn: { icon: logLevelIcons.warn, color: logLevelColors.warn },
    info: { icon: logLevelIcons.info, color: logLevelColors.info },
    debug: { icon: logLevelIcons.debug, color: logLevelColors.debug },
};

/**
 * Format a value for single-line display.
 *
 * Primitives are displayed directly, objects are stringified.
 */
function formatValue(value: unknown): string {

    if (value === null) {

        return dataFormatters.nil();

    }

    if (value === undefined) {

        return theme.muted('undefined');

    }

    if (typeof value === 'string') {

        return value.length > 50
            ? theme.text(`"${value.slice(0, 47)}..."`)
            : theme.text(value);

    }

    if (typeof value === 'number') {

        return dataFormatters.number(value);

    }

    if (typeof value === 'boolean') {

        return dataFormatters.boolean(value);

    }

    if (value instanceof Date) {

        return theme.muted(value.toISOString());

    }

    if (value instanceof Error) {

        return theme.error(value.message);

    }

    if (Array.isArray(value)) {

        if (value.length === 0) {

            return theme.muted('[]');

        }

        if (value.length <= 3 && value.every((v) => typeof v === 'string' || typeof v === 'number')) {

            return theme.text(`[${value.join(', ')}]`);

        }

        return theme.muted(`[${value.length} items]`);

    }

    if (typeof value === 'object') {

        const [str, error] = attemptSync(() => JSON.stringify(value));

        if (error) {

            return theme.muted('[object]');

        }

        return theme.text(str.length > 60 ? str.slice(0, 57) + '...' : str);

    }

    return theme.text(String(value));

}

/**
 * Flatten data to key=value pairs, one level deep.
 */
function flattenData(data: Record<string, unknown>): string {

    const pairs: string[] = [];

    for (const [key, value] of Object.entries(data)) {

        pairs.push(`${theme.muted(key)}=${formatValue(value)}`);

    }

    return pairs.join(' ');

}

/**
 * Format a log entry as a colored line.
 *
 * Format: `[icon] event  message  key=value key=value ...`
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

    let line = `${icon} ${eventStr}  ${theme.text(message)}`;

    if (data && Object.keys(data).length > 0) {

        line += `  ${flattenData(data)}`;

    }

    return line;

}

/**
 * Status icons for common result types.
 * Uses theme colors for consistency.
 */
export const STATUS_ICONS = {
    success: theme.success('✓'),
    failed: theme.error('✗'),
    partial: theme.warning('⚠'),
    pending: theme.warning('○'),
    skipped: theme.muted('○'),
    reverted: theme.info('↩'),
} as const;

/**
 * Format duration for display.
 */
export function formatDuration(ms: number): string {

    return dataFormatters.duration(ms);

}

/**
 * Re-export ansis for direct use where needed.
 */
export { ansis };
