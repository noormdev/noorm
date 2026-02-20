/**
 * Dialect-aware identifier quoting for SQL generation.
 *
 * Eliminates duplicate quote/qualifiedName implementations across
 * teardown dialects by parameterizing the quote characters.
 *
 * @example
 * ```typescript
 * const pg = createDialectQuoting({ open: '"', close: '"', escape: '""', defaultSchema: 'public' });
 * pg.quote('users');                    // → "users"
 * pg.qualifiedName('users', 'public');  // → "users"  (default schema omitted)
 * pg.qualifiedName('users', 'audit');   // → "audit"."users"
 * ```
 */

/**
 * Quoting operations for a SQL dialect.
 */
export interface DialectQuoting {
    /** Quote a single identifier. */
    quote(name: string): string;

    /** Build a fully qualified name with optional schema. */
    qualifiedName(name: string, schema?: string): string;
}

/**
 * Create dialect-specific quoting functions.
 *
 * @param opts.open - Opening quote character (e.g., `"`, `` ` ``, `[`)
 * @param opts.close - Closing quote character (e.g., `"`, `` ` ``, `]`)
 * @param opts.escape - Escape sequence for close char within identifiers
 * @param opts.defaultSchema - Schema to omit from qualified names (e.g., 'public', 'dbo')
 */
export function createDialectQuoting(opts: {
    open: string;
    close: string;
    escape: string;
    defaultSchema?: string;
}): DialectQuoting {

    const { open, close, escape, defaultSchema } = opts;

    const escapeRegex = new RegExp(close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

    function quote(name: string): string {

        return `${open}${name.replace(escapeRegex, escape)}${close}`;

    }

    function qualifiedName(name: string, schema?: string): string {

        if (schema && schema !== defaultSchema) {

            return `${quote(schema)}.${quote(name)}`;

        }

        return quote(name);

    }

    return { quote, qualifiedName };

}
