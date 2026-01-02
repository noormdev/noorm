/**
 * Help Text Formatter
 *
 * Parses markdown help text and applies terminal colors
 * using the Modern Slate theme.
 *
 * Supported syntax:
 * - `# Heading` → bold primary (title)
 * - `## Heading` → bold secondary (section)
 * - `### Heading` → bold muted (subsection)
 * - `> blockquote` → dimmed italic
 * - ```lang ... ``` code blocks → muted delimiters, info code
 * - `inline code` → info color
 * - `    indented` lines → command highlighting
 * - `[optional]` → muted brackets and content
 * - `<required>` → warning color
 * - `NAME` (all caps) → argument placeholder style
 * - **bold** → bold text
 * - *italic* → italic text
 * - Regular text → default text color
 *
 * Command syntax highlighting:
 * - `noorm` → primary (command)
 * - subcommand → secondary color
 * - `-flag`, `--flag` → warning (amber)
 * - `[optional]` → muted
 * - `NAME` → placeholder style
 */
import ansis from 'ansis';

import { palette } from './theme.js';

// ─────────────────────────────────────────────────────────────
// Color Functions
// ─────────────────────────────────────────────────────────────

const colors = {
    // Headings
    h1: (s: string) => ansis.bold(ansis.hex(palette.primary)(s)),
    h2: (s: string) => ansis.bold(ansis.hex(palette.text)(s)),
    h3: (s: string) => ansis.bold(ansis.hex(palette.textDim)(s)),

    // Code
    code: (s: string) => ansis.hex(palette.info)(s),
    codeDelimiter: (s: string) => ansis.hex(palette.muted)(s),

    // Text
    text: (s: string) => ansis.hex(palette.text)(s),
    muted: (s: string) => ansis.hex(palette.muted)(s),
    bold: (s: string) => ansis.bold(ansis.hex(palette.text)(s)),
    italic: (s: string) => ansis.italic(ansis.hex(palette.textDim)(s)),

    // Blockquote
    blockquote: (s: string) => ansis.dim(ansis.italic(ansis.hex(palette.textDim)(s))),

    // Commands
    command: (s: string) => ansis.hex(palette.primary)(s),
    subcommand: (s: string) => ansis.hex(palette.info)(s),
    flag: (s: string) => ansis.hex(palette.warning)(s),
    placeholder: (s: string) => ansis.hex(palette.muted)(s),
    required: (s: string) => ansis.hex(palette.warning)(s),
    argument: (s: string) => ansis.italic(ansis.hex(palette.textDim)(s)),

    // Examples
    example: (s: string) => ansis.hex(palette.textDim)(s),
};

// ─────────────────────────────────────────────────────────────
// Inline Formatting
// ─────────────────────────────────────────────────────────────

/**
 * Apply inline formatting to a line of text.
 * Handles: `code`, **bold**, *italic*, [optional], <required>, NAME
 */
function formatInline(line: string): string {

    let result = line;

    // Inline code: `code` (do this first to prevent other formatting inside)
    result = result.replace(/`([^`]+)`/g, (_, code) => colors.code(code));

    // Bold: **text**
    result = result.replace(/\*\*([^*]+)\*\*/g, (_, text) => colors.bold(text));

    // Italic: *text* (but not inside **)
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, text) => colors.italic(text));

    // Optional args: [something]
    result = result.replace(/\[([^\]]+)\]/g, (_, content) =>
        colors.placeholder('[') + colors.placeholder(content) + colors.placeholder(']'));

    // Required args: <something>
    result = result.replace(/<([^>]+)>/g, (_, content) =>
        colors.muted('<') + colors.required(content) + colors.muted('>'));

    // All caps words (NAME, FILE, etc.) - argument placeholders
    // Only match standalone caps words, not inside other formatting
    result = result.replace(/\b([A-Z]{2,})\b/g, (_, word) => colors.argument(word));

    return result;

}

/**
 * Format command examples (lines containing noorm).
 * Highlights: noorm (command), subcommand, flags, placeholders
 */
function formatCommand(line: string): string {

    const trimmed = line.trim();

    // Not a command line
    if (!trimmed.includes('noorm') && !trimmed.startsWith('$')) {

        return line;

    }

    // Get leading whitespace
    const leadingSpace = line.match(/^(\s*)/)?.[1] || '';
    let content = trimmed;

    // Handle $ prefix
    let prefix = '';

    if (content.startsWith('$')) {

        prefix = colors.muted('$ ');
        content = content.slice(1).trim();

    }

    // Split into tokens
    const tokens = content.split(/\s+/);
    const formatted: string[] = [];

    let foundNoorm = false;
    let foundSubcommand = false;

    for (const token of tokens) {

        // noorm command
        if (token === 'noorm') {

            formatted.push(colors.command('noorm'));
            foundNoorm = true;
            continue;

        }

        // Flags: -H, --json, --config
        if (token.startsWith('-')) {

            formatted.push(colors.flag(token));
            continue;

        }

        // [optional] placeholders
        if (token.startsWith('[') && token.endsWith(']')) {

            const inner = token.slice(1, -1);
            formatted.push(
                colors.placeholder('[') +
                colors.placeholder(inner) +
                colors.placeholder(']'),
            );
            continue;

        }

        // <required> placeholders
        if (token.startsWith('<') && token.endsWith('>')) {

            const inner = token.slice(1, -1);
            formatted.push(
                colors.muted('<') +
                colors.required(inner) +
                colors.muted('>'),
            );
            continue;

        }

        // ALL CAPS argument placeholders (NAME, FILE, etc.)
        if (/^[A-Z]{2,}$/.test(token)) {

            formatted.push(colors.argument(token));
            continue;

        }

        // First word after noorm is subcommand
        if (foundNoorm && !foundSubcommand && !token.startsWith('-')) {

            formatted.push(colors.subcommand(token));
            foundSubcommand = true;
            continue;

        }

        // Regular text (could be description after command)
        formatted.push(colors.text(token));

    }

    return leadingSpace + prefix + formatted.join(' ');

}

// ─────────────────────────────────────────────────────────────
// Block Formatting
// ─────────────────────────────────────────────────────────────

/**
 * Check if a line is a markdown heading (# or ## or ###).
 */
function parseHeading(line: string): { level: number; text: string } | null {

    const match = line.match(/^(#{1,3})\s+(.+)$/);

    if (match && match[1] && match[2]) {

        return { level: match[1].length, text: match[2] };

    }

    return null;

}

/**
 * Check if a line is a blockquote (> text).
 */
function parseBlockquote(line: string): string | null {

    const match = line.match(/^>\s*(.*)$/);

    if (match) {

        return match[1] || '';

    }

    return null;

}

/**
 * Format a complete help text with colors.
 */
export function formatHelp(text: string): string {

    const lines = text.split('\n');
    const output: string[] = [];

    let inCodeBlock = false;

    for (const line of lines) {

        // Code block start/end: ```
        if (line.trim().startsWith('```')) {

            if (!inCodeBlock) {

                // Starting code block
                inCodeBlock = true;
                output.push(colors.codeDelimiter(line));

            }
            else {

                // Ending code block
                inCodeBlock = false;
                output.push(colors.codeDelimiter(line));

            }

            continue;

        }

        // Inside code block - all code colored
        if (inCodeBlock) {

            output.push(colors.code(line));
            continue;

        }

        // Markdown heading: #, ##, or ###
        const heading = parseHeading(line);

        if (heading) {

            const colorFn = heading.level === 1 ? colors.h1
                : heading.level === 2 ? colors.h2
                    : colors.h3;

            output.push(colorFn(heading.text));
            continue;

        }

        // Blockquote: > text
        const blockquoteContent = parseBlockquote(line);

        if (blockquoteContent !== null) {

            // Apply inline formatting first (bold, italic, code), then blockquote styling
            const formatted = formatInline(blockquoteContent);
            output.push(colors.blockquote('  ' + formatted));
            continue;

        }

        // Indented line (4+ spaces or tab) - treat as example/code
        if (/^(\s{4,}|\t)/.test(line)) {

            // Check if it's a command example
            if (line.includes('noorm') || line.trim().startsWith('$')) {

                output.push(formatCommand(line));

            }
            else {

                // Format with inline formatting (handles [optional], NAME, etc.)
                output.push(colors.example(formatInline(line)));

            }

            continue;

        }

        // Empty line
        if (line.trim() === '') {

            output.push('');
            continue;

        }

        // Regular text with inline formatting
        output.push(colors.text(formatInline(line)));

    }

    return output.join('\n');

}

/**
 * Strip ANSI codes from text (for testing or plain output).
 */
export function stripColors(text: string): string {

    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');

}
