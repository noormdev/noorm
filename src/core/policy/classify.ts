import { cstVisitor, parse, type Program } from 'sql-parser-cst';
import { attemptSync } from '@logosdx/utils';

import type { Dialect } from '../connection/types.js';

/**
 * Statement classification. Multi-statement input takes the highest class
 * present (`read < write < ddl`).
 */
export type SqlClass = 'read' | 'write' | 'ddl';

/**
 * Dialect mapping from noorm to sql-parser-cst.
 */
const DIALECT_MAP: Record<Dialect, 'sqlite' | 'postgresql' | 'mysql' | 'bigquery'> = {
    sqlite: 'sqlite',
    postgres: 'postgresql',
    mysql: 'mysql',
    mssql: 'postgresql', // best-effort — fall back to keyword if parser chokes
};

/**
 * CST statement types that are read-only.
 *
 * `explain_stmt` is deliberately absent: an EXPLAIN inherits the class of the
 * statement it wraps (see `classifyStmtType`), because postgres `EXPLAIN
 * ANALYZE` *executes* that statement. `compound_select_stmt` is the node for
 * UNION/INTERSECT/EXCEPT and appears nested inside ordinary subqueries, so
 * omitting it denied plain reads.
 */
const READ_STMT_TYPES: Record<string, true> = {
    select_stmt: true,
    compound_select_stmt: true,
    show_stmt: true,
    describe_stmt: true,
};

/**
 * CST statement types that write data without changing schema.
 */
const WRITE_STMT_TYPES: Record<string, true> = {
    insert_stmt: true,
    update_stmt: true,
    delete_stmt: true,
    merge_stmt: true,
};

/**
 * Keywords that indicate a read-only statement (uppercase).
 *
 * `EXPLAIN` is deliberately absent — see `classifyExplained`. It used to sit
 * here, which made `EXPLAIN (ANALYZE) DELETE FROM t` a `read` and let a
 * `viewer` role delete rows on postgres.
 */
const READ_KEYWORDS: Record<string, true> = {
    SELECT: true,
    SHOW: true,
    DESCRIBE: true,
    DESC: true,
};

/**
 * Keywords that indicate a data-writing statement (uppercase).
 */
const WRITE_KEYWORDS: Record<string, true> = {
    INSERT: true,
    UPDATE: true,
    DELETE: true,
    MERGE: true,
};

/**
 * Every keyword that can legitimately start a statement. Used to tell an
 * EXPLAIN's wrapped statement apart from MySQL's `EXPLAIN <table>` form,
 * which is a synonym for DESCRIBE and carries no statement at all.
 */
const STATEMENT_KEYWORDS: Record<string, true> = {
    ...READ_KEYWORDS,
    ...WRITE_KEYWORDS,
    EXPLAIN: true,
    WITH: true,
};

/**
 * Words that may appear between `EXPLAIN` and the statement it wraps, across
 * postgres/mysql/sqlite. Skipped when locating the wrapped statement.
 *
 * An explicit list, not "skip anything unrecognised": skipping unknown words
 * would walk straight past an unrecognised *verb* (`EXPLAIN ANALYZE REFRESH
 * MATERIALIZED VIEW ...`) and report the whole thing as a read.
 */
const EXPLAIN_OPTION_KEYWORDS: Record<string, true> = {
    ANALYZE: true,
    ANALYSE: true,
    VERBOSE: true,
    EXTENDED: true,
    PARTITIONS: true,
    QUERY: true,
    PLAN: true,
    FORMAT: true,
    TEXT: true,
    XML: true,
    JSON: true,
    YAML: true,
    TREE: true,
    TRADITIONAL: true,
    FOR: true,
    CONNECTION: true,
};

/**
 * Ordering used to resolve the highest class across a multi-statement input.
 */
const CLASS_RANK: Record<SqlClass, number> = { read: 0, write: 1, ddl: 2 };

/**
 * Builtins that must not be reachable from a `viewer` role just because
 * they're invoked from a SELECT. Guardrail against a `viewer` config running
 * `SELECT pg_terminate_backend(...)` through the read-allowed `sql` path.
 *
 * Covers two families: side-effecting builtins, and builtins that read the
 * *database server's* filesystem. The second family is not a write, but
 * "viewer" promises read-only access to the data, not to the host — and
 * `SELECT pg_read_file('postgresql.conf')` is exfiltration wearing a SELECT.
 * Both escalate to `write`, which is the lowest class that denies `viewer`.
 *
 * Deliberately a denylist, not an allowlist: `SELECT f()` is statically
 * undecidable, so pure helpers (`count`, `now`, `coalesce`, ...) stay `read`
 * and only known-dangerous calls are caught. An unlisted side-effecting
 * function on a viewer config is a documented limitation — this guards
 * against casual/accidental writes, not a determined adversary.
 */
export const DESTRUCTIVE_FUNCTIONS: ReadonlySet<string> = new Set([
    'pg_terminate_backend',
    'pg_cancel_backend',
    'pg_reload_conf',
    'pg_rotate_logfile',
    'pg_promote',
    'pg_switch_wal',
    'pg_create_restore_point',
    'pg_drop_replication_slot',
    'lo_import',
    'lo_export',
    'lo_unlink',
    'setval',
    'nextval',
    'dblink_exec',
    'query_to_xml',
    'query_to_xmlschema',
    'query_to_xml_and_xmlschema',
    'cursor_to_xml',
    'cursor_to_xmlschema',
    'pg_read_file',
    'pg_read_binary_file',
    'pg_stat_file',
    'pg_ls_dir',
    'pg_ls_logdir',
    'pg_ls_waldir',
]);

/**
 * Word-boundary match for a denylisted function call, used by the keyword
 * fallback. Built once from `DESTRUCTIVE_FUNCTIONS` rather than per call.
 */
const DESTRUCTIVE_FUNCTION_PATTERN = new RegExp(`\\b(?:${[...DESTRUCTIVE_FUNCTIONS].join('|')})\\s*\\(`, 'i');

/**
 * Classify raw SQL as `read`, `write`, or `ddl`.
 *
 * Strategy: try sql-parser-cst first, fall back to keyword-based
 * if the parser throws (e.g., MSSQL-specific syntax). Anything not
 * recognized as read or write — CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE/SET,
 * EXEC/CALL, or input the parser can't make sense of — classifies as `ddl`:
 * fail closed, since an unrecognized statement could do anything.
 *
 * @example
 * classifyStatements('SELECT * FROM users', 'postgres'); // 'read'
 * classifyStatements("INSERT INTO users (name) VALUES ('x')", 'postgres'); // 'write'
 * classifyStatements('DROP TABLE users', 'postgres'); // 'ddl'
 */
export function classifyStatements(sql: string, dialect: Dialect): SqlClass {

    const trimmed = sql.trim();

    if (trimmed === '') return 'read';

    // Try CST parser
    const [result, err] = attemptSync(() =>
        parse(trimmed, {
            dialect: DIALECT_MAP[dialect],
            includeComments: false,
            includeSpaces: false,
            includeNewlines: false,
        }),
    );

    if (!err && result) {

        return classifyCst(result);

    }

    // Parser failed — fall back to keyword-based
    return classifyKeyword(trimmed, dialect);

}

/**
 * Classify via CST. Highest class of any statement node anywhere in the tree
 * wins, plus `write` for a denylisted function call anywhere.
 *
 * Scanning the *whole* tree rather than just `program.statements` is the
 * point: a statement's real impact is routinely carried by a nested node —
 * a data-modifying CTE body (`WITH t AS (DELETE ...) SELECT ...`), or the
 * statement an `EXPLAIN ANALYZE` executes. The previous version enumerated
 * the nested node types it cared about and had no DDL entry, so
 * `EXPLAIN ANALYZE CREATE TABLE x AS SELECT 1` classified as `read` and
 * created the table under a `viewer` role. Walking generically inverts the
 * default: an unrecognised nested statement escalates instead of hiding.
 */
function classifyCst(program: Program): SqlClass {

    const highest = nestedStatementClass(program);

    return containsDestructiveCall(program) ? maxClass(highest, 'write') : highest;

}

/**
 * Highest class of every `*_stmt` node reachable in the tree.
 *
 * Deliberately structural rather than type-driven: any node whose `type`
 * ends in `_stmt` is a statement, and `classifyStmtType` already fails
 * closed on statement types it does not recognise. That means a grammar
 * upgrade adding new DDL node types is covered on arrival, with no list to
 * keep in sync.
 */
function nestedStatementClass(node: unknown): SqlClass {

    if (Array.isArray(node)) {

        return node.reduce<SqlClass>((highest, item) => maxClass(highest, nestedStatementClass(item)), 'read');

    }

    if (node === null || typeof node !== 'object') return 'read';

    const { type } = node as { type?: unknown };
    const own = typeof type === 'string' && type.endsWith('_stmt')
        ? classifyStmtType(node as CstStatement)
        : 'read';

    return Object.values(node).reduce<SqlClass>((highest, value) => maxClass(highest, nestedStatementClass(value)), own);

}

/**
 * True when the tree contains a call to a `DESTRUCTIVE_FUNCTIONS` builtin
 * anywhere. Signals at least `write` regardless of what the outer/final
 * statement looks like.
 */
function containsDestructiveCall(program: Program): boolean {

    let found = false;

    const visit = cstVisitor({
        func_call: (node) => {

            // A schema-qualified call (`pg_catalog.pg_terminate_backend(...)`) parses to a
            // member_expr name; its `property` is the called identifier regardless of
            // qualification depth (`db.pg_catalog.fn` nests further qualifiers under
            // `object`, so `property` is always the rightmost/actual function name).
            const funcName = node.name.type === 'identifier' ? node.name : node.name.property;

            if (funcName.type === 'identifier' && DESTRUCTIVE_FUNCTIONS.has(funcName.name.toLowerCase())) {

                found = true;

            }

        },
    });

    visit(program);

    return found;

}

/** The shape `classifyStmtType` needs from a CST statement node. */
interface CstStatement {
    type: string;
    clauses?: Array<{ type: string }>;
    /** Present on `explain_stmt`: the statement being explained. */
    statement?: unknown;
}

/**
 * Map a single CST statement to a class. `empty` covers comment-only
 * or whitespace-only input that still parses successfully.
 *
 * An `explain_stmt` takes the class of the statement it wraps rather than a
 * class of its own. Postgres `EXPLAIN ANALYZE` executes the wrapped
 * statement — planning a DELETE deletes rows — so the wrapper cannot be the
 * verdict. An EXPLAIN with nothing recognisable inside fails closed.
 *
 * A `select_stmt` carrying an INTO clause (`into_table_clause`,
 * `into_outfile_clause`, `into_variables_clause`, `into_dumpfile_clause`)
 * redirects the result set into a new table or a file instead of returning
 * rows — that's schema-creation or exfiltration, not a read. Fail closed
 * to `ddl` for any INTO variant rather than special-casing which ones
 * actually touch schema.
 */
function classifyStmtType(stmt: CstStatement): SqlClass {

    if (stmt.type === 'explain_stmt') {

        const inner = stmt.statement as CstStatement | undefined;

        return inner && typeof inner.type === 'string' ? classifyStmtType(inner) : 'ddl';

    }

    if (stmt.type === 'select_stmt' && stmt.clauses?.some((clause) => clause.type.startsWith('into_'))) {

        return 'ddl';

    }

    if (stmt.type === 'empty' || READ_STMT_TYPES[stmt.type]) return 'read';
    if (WRITE_STMT_TYPES[stmt.type]) return 'write';

    return 'ddl';

}

/**
 * Classify via keyword analysis.
 *
 * Masks everything that isn't code (string literals, quoted identifiers,
 * comments), splits on semicolons, checks the leading keyword of each
 * statement, takes the highest class present.
 *
 * This is not a rare backstop: `mssql` has no grammar of its own here and
 * maps to the postgres parser, so MSSQL syntax lands on this path routinely.
 */
function classifyKeyword(sql: string, dialect: Dialect): SqlClass {

    const masked = maskNonCode(sql, dialect);
    const statements = splitStatements(masked);

    if (statements.length === 0) return 'read';

    let highest: SqlClass = 'read';

    for (const stmt of statements) {

        highest = maxClass(highest, classifyKeywordStatement(stmt));

    }

    if (DESTRUCTIVE_FUNCTION_PATTERN.test(masked)) {

        highest = maxClass(highest, 'write');

    }

    return highest;

}

/**
 * Leading keyword of a statement, ignoring wrapping parens
 * (`(SELECT 1) UNION (SELECT 2)`). `undefined` when the statement does not
 * begin with a word character at all — a leading control byte, say — which
 * callers must treat as unrecognised rather than harmless.
 */
function leadingKeyword(upper: string): string | undefined {

    return upper.replace(/^[\s(]+/, '').match(/^(\w+)/)?.[1];

}

/**
 * Classify a single statement (already masked, no semicolons) by its leading
 * keyword. Handles CTEs via paren-depth tracking for the WITH keyword.
 *
 * A leading SELECT carrying a top-level INTO (MSSQL `INTO #temp`, MySQL
 * `INTO OUTFILE`/`INTO @var`) is checked before the generic READ_KEYWORDS
 * lookup — the CST parser can reject dialect-specific INTO targets (e.g.
 * `#temp`), so this fallback must catch them too. Fail closed to `ddl`.
 *
 * A statement with no leading word character is unrecognised input, not an
 * empty one (`splitStatements` already drops those), so it fails closed.
 * Answering `read` there let a leading NUL byte carry a DROP past the gate.
 */
function classifyKeywordStatement(stmt: string): SqlClass {

    const upper = stmt.toUpperCase();
    const firstWord = leadingKeyword(upper);

    if (!firstWord) return 'ddl';

    if (firstWord === 'EXPLAIN') {

        return classifyExplained(upper);

    }

    if (firstWord === 'SELECT') {

        return hasTopLevelInto(upper) ? 'ddl' : 'read';

    }

    if (READ_KEYWORDS[firstWord]) return 'read';

    // Handle WITH ... <stmt> (CTE)
    if (firstWord === 'WITH') {

        return classifyCte(upper);

    }

    if (WRITE_KEYWORDS[firstWord]) return 'write';

    return 'ddl';

}

/**
 * Classify an `EXPLAIN` by the statement it wraps.
 *
 * `EXPLAIN` is never a verdict of its own. Postgres executes the wrapped
 * statement when ANALYZE is on, and the parenthesised option form the
 * postgres docs lead with — `EXPLAIN (ANALYZE) DELETE FROM t` — is rejected
 * by the CST parser, so it lands here. Treating the keyword as read let a
 * `viewer` role run arbitrary DML through the CLI and over MCP.
 *
 * The one thing an EXPLAIN can wrap that is not a statement is MySQL's
 * `EXPLAIN <table>` (a synonym for DESCRIBE). That is recognised narrowly —
 * a single bare identifier and nothing else — so it cannot be stretched to
 * cover a real verb.
 */
function classifyExplained(upper: string): SqlClass {

    const wrapped = stripExplainOptions(upper);

    if (wrapped === '') return 'read';

    const keyword = leadingKeyword(wrapped);

    if (keyword && !STATEMENT_KEYWORDS[keyword] && /^[\w.$]+$/.test(wrapped)) return 'read';

    return classifyKeywordStatement(wrapped);

}

/**
 * Everything after `EXPLAIN` and its options — the statement being explained.
 *
 * Consumes a parenthesised option list (`(ANALYZE, FORMAT JSON)`), bare
 * option keywords (`ANALYZE VERBOSE`, sqlite's `QUERY PLAN`), and MySQL's
 * `FORMAT=JSON` punctuation. Stops at the first word that is not a known
 * option, which is the wrapped statement's own verb.
 */
function stripExplainOptions(upper: string): string {

    let rest = upper.replace(/^[\s(]*EXPLAIN/, '').trimStart();

    while (rest !== '') {

        if (rest.startsWith('(')) {

            rest = rest.slice(findMatchingParen(rest, 0) + 1).trimStart();
            continue;

        }

        if (rest.startsWith('=') || rest.startsWith(',')) {

            rest = rest.slice(1).trimStart();
            continue;

        }

        const word = rest.match(/^(\w+)/)?.[1];

        if (!word || !EXPLAIN_OPTION_KEYWORDS[word]) break;

        rest = rest.slice(word.length).trimStart();

    }

    return rest;

}

/**
 * Classify a CTE (WITH ...): the highest of (a) the final statement's own
 * class and (b) any data-modifying CTE definition's class. A `WITH t AS
 * (DELETE ...) SELECT ...` must classify as `write` even though the final
 * statement is a SELECT — keying only off the final keyword would miss it.
 */
function classifyCte(upper: string): SqlClass {

    return maxClass(classifyCteDefinitions(upper), classifyCteFinalStatement(upper));

}

/**
 * Classify a CTE by the keyword of its final statement.
 *
 * Finds the keyword right after the CTE definition list ends, using the
 * same `AS (...)` boundary as `classifyCteDefinitions` — not just the
 * last top-level closing paren, which a subquery inside the final
 * statement itself (`... WHERE id IN (SELECT ...)`) would also close at
 * depth 0, misidentifying the CTE boundary.
 */
function classifyCteFinalStatement(upper: string): SqlClass {

    const cteEnd = findCteDefinitionsEnd(upper);

    if (cteEnd === -1) return 'ddl';

    const afterCte = upper.slice(cteEnd).trim();

    // Skip optional comma (recursive CTEs)
    const finalStmt = afterCte.replace(/^,/, '').trim();
    const finalKeyword = finalStmt.match(/^(\w+)/)?.[1];

    if (finalKeyword === 'SELECT') return hasTopLevelInto(finalStmt) ? 'ddl' : 'read';
    if (finalKeyword && READ_KEYWORDS[finalKeyword]) return 'read';
    if (finalKeyword && WRITE_KEYWORDS[finalKeyword]) return 'write';

    return 'ddl';

}

/**
 * Index just past the closing paren of the last `name AS (...)` CTE
 * definition — the boundary between the definition list and the final
 * statement. Walks the same comma-separated, depth-0 `AS (...)` structure
 * as `classifyCteDefinitions` so a paren inside the final statement's own
 * subquery is never mistaken for this boundary.
 */
function findCteDefinitionsEnd(upper: string): number {

    let depth = 0;
    let i = 0;
    let end = -1;

    while (i < upper.length) {

        if (upper[i] === '(') {

            if (depth === 0 && isPrecededByAsKeyword(upper, i)) {

                const bodyEnd = findMatchingParen(upper, i);

                end = bodyEnd + 1;
                i = bodyEnd + 1;
                continue;

            }

            depth++;
            i++;
            continue;

        }

        if (upper[i] === ')') {

            depth--;
            i++;
            continue;

        }

        i++;

    }

    return end;

}

/**
 * Scan each top-level CTE definition body (`name AS (...)`) for a leading
 * data-modifying or DDL keyword. Mirrors the CST path's inspection of the
 * parsed CTE's inner statement type, for dialects where the parser throws
 * and classification falls back to keywords.
 */
function classifyCteDefinitions(upper: string): SqlClass {

    let highest: SqlClass = 'read';
    let depth = 0;
    let i = 0;

    while (i < upper.length) {

        if (upper[i] === '(') {

            if (depth === 0 && isPrecededByAsKeyword(upper, i)) {

                const bodyEnd = findMatchingParen(upper, i);
                const body = upper.slice(i + 1, bodyEnd).trim();

                highest = maxClass(highest, classifyCteBodyKeyword(body));

                i = bodyEnd + 1;
                continue;

            }

            depth++;
            i++;
            continue;

        }

        if (upper[i] === ')') {

            depth--;
            i++;
            continue;

        }

        i++;

    }

    return highest;

}

/**
 * True when the `(` at `openIdx` is immediately preceded (ignoring
 * whitespace) by a standalone `AS` keyword — the shape of a CTE
 * definition's `name AS (...)` body, as opposed to a column-list paren
 * (`name(a, b)`) or an unrelated nested paren.
 */
function isPrecededByAsKeyword(text: string, openIdx: number): boolean {

    let j = openIdx - 1;

    while (j >= 0) {

        const ch = text[j];

        if (ch === undefined || !/\s/.test(ch)) break;

        j--;

    }

    if (j < 1 || text[j] !== 'S' || text[j - 1] !== 'A') return false;

    const before = text[j - 2];

    return before === undefined || !/\w/.test(before);

}

/**
 * Index of the `)` matching the `(` at `openIdx`, tracking nested depth.
 * Falls back to the end of the string for malformed/unterminated input.
 */
function findMatchingParen(text: string, openIdx: number): number {

    let depth = 0;

    for (let k = openIdx; k < text.length; k++) {

        if (text[k] === '(') depth++;
        if (text[k] === ')') {

            depth--;

            if (depth === 0) return k;

        }

    }

    return text.length - 1;

}

/**
 * Classify a single CTE definition body by its leading keyword. Recurses
 * for a CTE-within-a-CTE (`t AS (WITH inner AS (...) SELECT ...)`).
 */
function classifyCteBodyKeyword(body: string): SqlClass {

    const firstWord = body.match(/^(\w+)/)?.[1];

    if (!firstWord) return 'read';
    if (firstWord === 'WITH') return classifyCte(body);
    if (READ_KEYWORDS[firstWord]) return 'read';
    if (WRITE_KEYWORDS[firstWord]) return 'write';

    return 'ddl';

}

/**
 * True when a top-level ` INTO ` keyword appears outside parentheses.
 *
 * Operates on masked input, so an INTO inside a string literal
 * (`'INTO table'`) or a quoted identifier (`[INTO]`) is already blanked and
 * only paren depth is left to track — an INTO nested in a subquery is not a
 * SELECT ... INTO target.
 */
function hasTopLevelInto(masked: string): boolean {

    let depth = 0;

    for (let i = 0; i < masked.length; i++) {

        if (masked[i] === '(') {

            depth++;
            continue;

        }

        if (masked[i] === ')') {

            depth--;
            continue;

        }

        if (
            depth === 0 &&
            masked.startsWith('INTO', i) &&
            !/\w/.test(masked[i - 1] ?? ' ') &&
            !/\w/.test(masked[i + 4] ?? ' ')
        ) {

            return true;

        }

    }

    return false;

}

/**
 * Resolve the higher-impact of two classes (`read < write < ddl`).
 */
function maxClass(a: SqlClass, b: SqlClass): SqlClass {

    return CLASS_RANK[b] > CLASS_RANK[a] ? b : a;

}

/**
 * Split masked SQL on semicolons.
 *
 * Safe as a plain split because `maskNonCode` has already blanked every
 * region a semicolon could be hiding in. The previous version tracked `'`
 * inline and nothing else, so an MSSQL bracket identifier holding an odd
 * number of apostrophes (`SELECT 1 AS [a'b]; DROP TABLE x`) desynced it into
 * a phantom string literal that swallowed the separator — and the DROP was
 * never classified at all.
 */
function splitStatements(masked: string): string[] {

    return masked
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

}

/** A paired delimiter whose contents are data rather than code. */
interface QuoteForm {
    open: string;
    close: string;
}

const SINGLE_QUOTE: QuoteForm = { open: "'", close: "'" };
const DOUBLE_QUOTE: QuoteForm = { open: '"', close: '"' };
const BACKTICK: QuoteForm = { open: '`', close: '`' };
const BRACKET: QuoteForm = { open: '[', close: ']' };

/**
 * Quoting forms recognised per dialect, in match order.
 *
 * Dialect-scoped rather than universal because the same character means
 * different things: `[...]` delimits an identifier on MSSQL and SQLite but
 * subscripts an array on postgres, so masking it everywhere would blank real
 * code — including parens, which would desync the depth tracking that CTE
 * boundary detection depends on.
 */
const QUOTE_FORMS: Record<Dialect, readonly QuoteForm[]> = {
    postgres: [SINGLE_QUOTE, DOUBLE_QUOTE],
    mysql: [SINGLE_QUOTE, DOUBLE_QUOTE, BACKTICK],
    sqlite: [SINGLE_QUOTE, DOUBLE_QUOTE, BACKTICK, BRACKET],
    mssql: [SINGLE_QUOTE, DOUBLE_QUOTE, BRACKET],
};

/**
 * Blank every non-code region — string literals, quoted identifiers, and
 * comments — replacing each character with a space so offsets are preserved.
 *
 * One scanner instead of the four that used to track quotes independently
 * (`splitStatements`, `stripComments`, `hasTopLevelInto`,
 * `blankStringLiterals`), each modelling only `'`. Everything downstream can
 * then treat `;`, `(`, `)` and keywords as unambiguously structural, and a
 * new quoting form is fixed in one place rather than four.
 *
 * An unterminated quote or comment masks to end of input, which hides
 * whatever follows it — safe, because the database will reject the input
 * before executing any of it.
 */
function maskNonCode(sql: string, dialect: Dialect): string {

    const forms = QUOTE_FORMS[dialect];
    const hashComments = dialect === 'mysql';
    const dollarQuotes = dialect === 'postgres';

    let masked = '';
    let i = 0;

    while (i < sql.length) {

        const form = forms.find((candidate) => sql.startsWith(candidate.open, i));
        const dollarTag = dollarQuotes ? dollarQuoteTag(sql, i) : undefined;
        const end = form
            ? quotedRegionEnd(sql, i, form)
            : dollarTag
                ? dollarRegionEnd(sql, i, dollarTag)
                : commentRegionEnd(sql, i, hashComments);

        if (end === -1) {

            masked += sql[i];
            i++;
            continue;

        }

        masked += ' '.repeat(end - i);
        i = end;

    }

    return masked;

}

/**
 * Index just past a quoted region opened at `openIdx`. A doubled closing
 * delimiter (`''`, `""`, `` `` ``, `]]`) is an escaped literal, not the end.
 */
function quotedRegionEnd(sql: string, openIdx: number, form: QuoteForm): number {

    let i = openIdx + form.open.length;

    while (i < sql.length) {

        if (sql.startsWith(form.close + form.close, i)) {

            i += form.close.length * 2;
            continue;

        }

        if (sql.startsWith(form.close, i)) return i + form.close.length;

        i++;

    }

    return sql.length;

}

/**
 * The postgres dollar-quote tag opening at `i` (`$$` or `$tag$`), or
 * `undefined`. Tags must start with a letter or underscore, which is what
 * keeps a parameter placeholder pair like `$1$2` from reading as one.
 */
function dollarQuoteTag(sql: string, i: number): string | undefined {

    if (sql[i] !== '$') return undefined;

    return sql.slice(i).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0];

}

/** Index just past a dollar-quoted body opened at `openIdx` with `tag`. */
function dollarRegionEnd(sql: string, openIdx: number, tag: string): number {

    const close = sql.indexOf(tag, openIdx + tag.length);

    return close === -1 ? sql.length : close + tag.length;

}

/**
 * Index just past a comment starting at `i`, or `-1` when `i` does not open
 * one. A line comment stops at (and preserves) its newline. `#` is a comment
 * introducer only on MySQL — on MSSQL it prefixes temp-table names.
 */
function commentRegionEnd(sql: string, i: number, hashComments: boolean): number {

    if (sql.startsWith('/*', i)) {

        const close = sql.indexOf('*/', i + 2);

        return close === -1 ? sql.length : close + 2;

    }

    if (sql.startsWith('--', i) || (hashComments && sql[i] === '#')) {

        const newline = sql.indexOf('\n', i);

        return newline === -1 ? sql.length : newline;

    }

    return -1;

}
