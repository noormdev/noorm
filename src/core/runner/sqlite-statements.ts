/**
 * SQLite statement splitter.
 *
 * Every other supported driver executes a multi-statement string in full:
 * postgres and mssql run all of it, mysql rejects it outright. SQLite's
 * `prepare()` compiles the *first* statement and silently discards the
 * rest, so handing it a whole file ran one statement, returned no error,
 * and let the runner record a checksum that guaranteed the dropped
 * statements were never retried.
 *
 * There is no way to ask bun:sqlite for the unconsumed tail, so the file
 * has to be split before it reaches the driver.
 *
 * Scope: this is a boundary scanner, not a SQL parser. It knows where a
 * statement can legally end — outside string literals, quoted identifiers,
 * comments, and trigger bodies — and nothing else about the SQL. A
 * construct it splits wrongly produces a syntax error from SQLite, which
 * is the loud failure the previous behavior lacked.
 */

/** Quote characters that open a literal or a quoted identifier in SQLite. */
const QUOTE_PAIRS: Record<string, string> = {
    '\'': '\'',
    '"': '"',
    '`': '`',
    '[': ']',
};

/**
 * Whether `keyword` sits at `index` as a whole word.
 *
 * Word boundaries matter because `BEGINNING`, `ENDPOINT` and a column
 * named `trigger_at` must not be read as the keywords they contain.
 */
function keywordAt(content: string, index: number, keyword: string): boolean {

    const end = index + keyword.length;

    if (content.slice(index, end).toUpperCase() !== keyword) return false;

    const before = index > 0 ? content[index - 1]! : ' ';
    const after = end < content.length ? content[end]! : ' ';

    return !/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after);

}

/**
 * Split a SQL file body into individually executable SQLite statements.
 *
 * Semicolons inside string literals, quoted identifiers (`"x"`, `` `x` ``,
 * `[x]`), `--` line comments, `/* *\/` block comments, and trigger bodies
 * are not boundaries. Trigger bodies are tracked by pairing `BEGIN`/`CASE`
 * against `END`, which is what keeps a `CASE … END;` inside a trigger from
 * being mistaken for the trigger's own terminator.
 *
 * `BEGIN` outside a `CREATE TRIGGER` is transaction control and opens
 * nothing — reading `BEGIN;` as a block would swallow the rest of the file.
 *
 * Statements are returned trimmed and in source order; blank and
 * comment-only fragments are dropped.
 *
 * @param content - Raw SQL file content
 * @returns Executable statements, in source order
 *
 * @example
 * ```typescript
 * splitSqliteStatements('CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);')
 * // → ['CREATE TABLE a (id INT);', 'CREATE TABLE b (id INT);']
 * ```
 */
export function splitSqliteStatements(content: string): string[] {

    const statements: string[] = [];

    let current = '';
    let closingQuote: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    let inTrigger = false;
    let blockDepth = 0;
    let i = 0;

    const flush = (): void => {

        const trimmed = current.trim();

        if (trimmed.length > 0 && !isCommentOnly(trimmed)) {

            statements.push(trimmed);

        }

        current = '';

    };

    while (i < content.length) {

        const char = content[i]!;

        if (inLineComment) {

            current += char;
            if (char === '\n') inLineComment = false;
            i++;
            continue;

        }

        if (inBlockComment) {

            current += char;

            if (char === '*' && content[i + 1] === '/') {

                current += '/';
                inBlockComment = false;
                i += 2;
                continue;

            }

            i++;
            continue;

        }

        if (closingQuote !== null) {

            current += char;

            if (char === closingQuote) {

                // Doubling is the escape for every SQLite quote style
                // (`''`, `""`, ` `` `); `]` has no escape and simply closes.
                if (closingQuote !== ']' && content[i + 1] === closingQuote) {

                    current += closingQuote;
                    i += 2;
                    continue;

                }

                closingQuote = null;

            }

            i++;
            continue;

        }

        if (char === '-' && content[i + 1] === '-') {

            inLineComment = true;
            current += '--';
            i += 2;
            continue;

        }

        if (char === '/' && content[i + 1] === '*') {

            inBlockComment = true;
            current += '/*';
            i += 2;
            continue;

        }

        if (QUOTE_PAIRS[char]) {

            closingQuote = QUOTE_PAIRS[char]!;
            current += char;
            i++;
            continue;

        }

        if (!inTrigger && keywordAt(content, i, 'TRIGGER')) {

            inTrigger = true;
            current += content.slice(i, i + 7);
            i += 7;
            continue;

        }

        if (inTrigger && (keywordAt(content, i, 'BEGIN') || keywordAt(content, i, 'CASE'))) {

            const length = keywordAt(content, i, 'BEGIN') ? 5 : 4;

            blockDepth++;
            current += content.slice(i, i + length);
            i += length;
            continue;

        }

        if (inTrigger && blockDepth > 0 && keywordAt(content, i, 'END')) {

            blockDepth--;
            if (blockDepth === 0) inTrigger = false;
            current += content.slice(i, i + 3);
            i += 3;
            continue;

        }

        if (char === ';' && blockDepth === 0) {

            current += char;
            inTrigger = false;
            flush();
            i++;
            continue;

        }

        current += char;
        i++;

    }

    flush();

    return statements;

}

/**
 * Whether a fragment carries no executable SQL — only comments and blanks.
 *
 * Used to drop the tail after a file's final `;` and to skip a file that is
 * nothing but a header comment, rather than sending SQLite an empty string.
 */
function isCommentOnly(fragment: string): boolean {

    const withoutBlockComments = fragment.replace(/\/\*[\s\S]*?\*\//g, '');

    return withoutBlockComments
        .split('\n')
        .every((line) => {

            const trimmed = line.trim();

            return trimmed.length === 0 || trimmed.startsWith('--');

        });

}
