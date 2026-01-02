/**
 * Modern Slate Color Theme
 *
 * Centralized color scheme for terminal output, UI elements,
 * and status indicators. Uses ansis for truecolor (hex) support.
 *
 * @example
 * ```typescript
 * import { theme, status, ui } from '../core/theme.js'
 *
 * // Status messages
 * console.log(status.success('Operation complete'))
 * console.log(status.error('Connection failed'))
 *
 * // UI elements
 * console.log(ui.primary('Submit'))
 * console.log(ui.muted('(optional)'))
 * ```
 */
import ansis from 'ansis';

// ─────────────────────────────────────────────────────────────
// Color Palette
// ─────────────────────────────────────────────────────────────

/**
 * Modern Slate color palette.
 * Hex values used directly with ansis truecolor support.
 */
export const palette = {

    // Brand
    primary: '#3B82F6',      // Bright Blue

    // Status
    success: '#10B981',      // Emerald Green
    warning: '#F59E0B',      // Amber
    error: '#EF4444',        // Red
    info: '#8B5CF6',         // Purple
    debug: '#8B5CF6',        // Purple (same as info)

    // UI Elements
    action: '#3B82F6',       // Primary Action (same as primary)
    secondary: '#6B7280',    // Gray-600
    muted: '#9CA3AF',        // Gray-400
    destructive: '#EF4444',  // Red (same as error)

    // Neutrals
    text: '#F3F4F6',         // Gray-100 (light text on dark bg)
    textDim: '#D1D5DB',      // Gray-300
    border: '#4B5563',       // Gray-600
    borderLight: '#6B7280',  // Gray-500
    background: '#1F2937',   // Gray-800

} as const;

// ─────────────────────────────────────────────────────────────
// Color Functions (Truecolor)
// ─────────────────────────────────────────────────────────────

/**
 * Theme color functions for direct use.
 * Uses ansis hex() for truecolor output.
 */
export const theme = {

    // Brand
    primary: (text: string) => ansis.hex(palette.primary)(text),

    // Status
    success: (text: string) => ansis.hex(palette.success)(text),
    warning: (text: string) => ansis.hex(palette.warning)(text),
    error: (text: string) => ansis.hex(palette.error)(text),
    info: (text: string) => ansis.hex(palette.info)(text),
    debug: (text: string) => ansis.hex(palette.debug)(text),

    // UI
    action: (text: string) => ansis.hex(palette.action)(text),
    secondary: (text: string) => ansis.hex(palette.secondary)(text),
    muted: (text: string) => ansis.hex(palette.muted)(text),
    destructive: (text: string) => ansis.hex(palette.destructive)(text),

    // Text
    text: (text: string) => ansis.hex(palette.text)(text),
    textDim: (text: string) => ansis.hex(palette.textDim)(text),

    // Borders
    border: (text: string) => ansis.hex(palette.border)(text),
    borderLight: (text: string) => ansis.hex(palette.borderLight)(text),

    // Utility
    bold: ansis.bold,
    dim: ansis.dim,
    italic: ansis.italic,
    underline: ansis.underline,
    inverse: ansis.inverse,
    reset: ansis.reset,

} as const;

// ─────────────────────────────────────────────────────────────
// Status Message Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Icons for status messages.
 */
export const icons = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: '•',
    debug: '○',
    pending: '◌',
    arrow: '→',
    bullet: '•',
    check: '✓',
    cross: '✗',
    star: '★',
    dot: '·',
} as const;

/**
 * Status message formatters with icons.
 */
export const status = {

    /**
     * Success message with checkmark.
     * @example status.success('Build complete')
     */
    success(message: string): string {

        return `${theme.success(icons.success)} ${theme.success(message)}`;

    },

    /**
     * Error message with X icon.
     * @example status.error('Connection failed')
     */
    error(message: string): string {

        return `${theme.error(icons.error)} ${theme.error(message)}`;

    },

    /**
     * Warning message with warning icon.
     * @example status.warning('Deprecated API')
     */
    warning(message: string): string {

        return `${theme.warning(icons.warning)} ${theme.warning(message)}`;

    },

    /**
     * Info message with bullet.
     * @example status.info('Processing 10 files')
     */
    info(message: string): string {

        return `${theme.info(icons.info)} ${theme.info(message)}`;

    },

    /**
     * Debug message with circle.
     * @example status.debug('Cache hit for key: user:123')
     */
    debug(message: string): string {

        return `${theme.debug(icons.debug)} ${theme.muted(message)}`;

    },

    /**
     * Pending/in-progress message.
     * @example status.pending('Connecting...')
     */
    pending(message: string): string {

        return `${theme.warning(icons.pending)} ${theme.textDim(message)}`;

    },

} as const;

// ─────────────────────────────────────────────────────────────
// UI Element Helpers
// ─────────────────────────────────────────────────────────────

/**
 * UI element formatters for buttons, labels, and interactive elements.
 */
export const ui = {

    /**
     * Primary action (buttons, highlights).
     * @example ui.primary('Submit')
     */
    primary(text: string): string {

        return theme.primary(text);

    },

    /**
     * Secondary action.
     * @example ui.secondary('Cancel')
     */
    secondary(text: string): string {

        return theme.secondary(text);

    },

    /**
     * Muted/disabled text.
     * @example ui.muted('(optional)')
     */
    muted(text: string): string {

        return theme.muted(text);

    },

    /**
     * Destructive action (delete, danger).
     * @example ui.destructive('Delete')
     */
    destructive(text: string): string {

        return theme.destructive(text);

    },

    /**
     * Keyboard shortcut badge.
     * @example ui.key('Enter')
     */
    key(text: string): string {

        return `${theme.muted('[')}${theme.text(text)}${theme.muted(']')}`;

    },

    /**
     * Highlighted/selected item.
     * @example ui.highlight('> Selected item')
     */
    highlight(text: string): string {

        return theme.primary(ansis.bold(text));

    },

    /**
     * Label with value.
     * @example ui.label('Name', 'John')
     */
    label(name: string, value: string): string {

        return `${theme.muted(name)}: ${theme.text(value)}`;

    },

    /**
     * Header text (bold primary).
     * @example ui.header('Configuration')
     */
    header(text: string): string {

        return theme.primary(ansis.bold(text));

    },

    /**
     * Section divider line.
     * @example ui.divider(40)
     */
    divider(width: number = 40): string {

        return theme.border('─'.repeat(width));

    },

} as const;

// ─────────────────────────────────────────────────────────────
// Modal/Box Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Box drawing characters for modals and frames.
 */
export const box = {

    // Single line
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',

    // Double line
    dTopLeft: '╔',
    dTopRight: '╗',
    dBottomLeft: '╚',
    dBottomRight: '╝',
    dHorizontal: '═',
    dVertical: '║',

    // Rounded
    rTopLeft: '╭',
    rTopRight: '╮',
    rBottomLeft: '╰',
    rBottomRight: '╯',

} as const;

/**
 * Modal/frame border helpers.
 */
export const borders = {

    /**
     * Create a horizontal border line.
     * @example borders.horizontal(40)
     */
    horizontal(width: number, style: 'single' | 'double' | 'rounded' = 'single'): string {

        const char = style === 'double' ? box.dHorizontal : box.horizontal;

        return theme.border(char.repeat(width));

    },

    /**
     * Create a top border with corners.
     * @example borders.top(40, 'rounded')
     */
    top(width: number, style: 'single' | 'double' | 'rounded' = 'single'): string {

        const left = style === 'double' ? box.dTopLeft
            : style === 'rounded' ? box.rTopLeft
                : box.topLeft;
        const right = style === 'double' ? box.dTopRight
            : style === 'rounded' ? box.rTopRight
                : box.topRight;
        const char = style === 'double' ? box.dHorizontal : box.horizontal;

        return theme.border(`${left}${char.repeat(width - 2)}${right}`);

    },

    /**
     * Create a bottom border with corners.
     * @example borders.bottom(40, 'rounded')
     */
    bottom(width: number, style: 'single' | 'double' | 'rounded' = 'single'): string {

        const left = style === 'double' ? box.dBottomLeft
            : style === 'rounded' ? box.rBottomLeft
                : box.bottomLeft;
        const right = style === 'double' ? box.dBottomRight
            : style === 'rounded' ? box.rBottomRight
                : box.bottomRight;
        const char = style === 'double' ? box.dHorizontal : box.horizontal;

        return theme.border(`${left}${char.repeat(width - 2)}${right}`);

    },

    /**
     * Create a vertical border character.
     */
    vertical(style: 'single' | 'double' = 'single'): string {

        const char = style === 'double' ? box.dVertical : box.vertical;

        return theme.border(char);

    },

    /**
     * Frame content with borders (for modals).
     * @example borders.frame('Title', 40, 'rounded')
     */
    frame(title: string, width: number, style: 'single' | 'double' | 'rounded' = 'single'): {
        top: string;
        bottom: string;
        side: string;
    } {

        const titleLen = title.length;
        const padding = Math.max(0, width - titleLen - 4);
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;

        const left = style === 'double' ? box.dTopLeft
            : style === 'rounded' ? box.rTopLeft
                : box.topLeft;
        const right = style === 'double' ? box.dTopRight
            : style === 'rounded' ? box.rTopRight
                : box.topRight;
        const char = style === 'double' ? box.dHorizontal : box.horizontal;

        const topLine = theme.border(left + char.repeat(leftPad + 1))
            + theme.primary(ansis.bold(title))
            + theme.border(char.repeat(rightPad + 1) + right);

        return {
            top: topLine,
            bottom: borders.bottom(width, style),
            side: borders.vertical(style === 'double' ? 'double' : 'single'),
        };

    },

} as const;

// ─────────────────────────────────────────────────────────────
// Data Display Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Data value formatters for logs and displays.
 */
export const data = {

    /**
     * Format a string value.
     */
    string(value: string): string {

        return theme.text(value);

    },

    /**
     * Format a number value.
     */
    number(value: number): string {

        return theme.warning(String(value));

    },

    /**
     * Format a boolean value.
     */
    boolean(value: boolean): string {

        return value ? theme.success('true') : theme.error('false');

    },

    /**
     * Format null/undefined.
     */
    nil(): string {

        return theme.muted('null');

    },

    /**
     * Format a key-value pair.
     * @example data.pair('name', 'John')
     */
    pair(key: string, value: unknown): string {

        const formatted = typeof value === 'number' ? data.number(value)
            : typeof value === 'boolean' ? data.boolean(value)
                : value === null || value === undefined ? data.nil()
                    : data.string(String(value));

        return `${theme.muted(key)}=${formatted}`;

    },

    /**
     * Format a file path.
     */
    path(filepath: string): string {

        return theme.info(filepath);

    },

    /**
     * Format a duration in milliseconds.
     */
    duration(ms: number): string {

        if (ms < 1000) {

            return theme.muted(`${ms}ms`);

        }

        return theme.muted(`${(ms / 1000).toFixed(2)}s`);

    },

    /**
     * Format a count/quantity.
     */
    count(n: number, singular: string, plural?: string): string {

        const word = n === 1 ? singular : (plural ?? `${singular}s`);

        return `${theme.warning(String(n))} ${theme.text(word)}`;

    },

} as const;

// ─────────────────────────────────────────────────────────────
// Logger Integration
// ─────────────────────────────────────────────────────────────

/**
 * Entry level colors for logger integration.
 * Maps log levels to theme colors.
 */
export const logLevelColors = {
    error: theme.error,
    warn: theme.warning,
    info: theme.info,
    debug: theme.debug,
} as const;

/**
 * Entry level icons for logger integration.
 */
export const logLevelIcons = {
    error: icons.error,
    warn: icons.warning,
    info: icons.info,
    debug: icons.debug,
} as const;
