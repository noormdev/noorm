import type { Dialect } from '../connection/types.js';
import { splitSqliteStatements } from '../runner/sqlite-statements.js';
import { invalidDefinition } from './errors.js';
import type { PipelineTransaction } from './types.js';

const MSSQL_TRANSACTION_CONTROL = new RegExp(
    '(?<![\\w@#$.])(?:BEGIN\\s+(?:DISTRIBUTED\\s+)?TRAN(?:SACTION)?\\b|COMMIT\\b|ROLLBACK\\b'
    + '|SAVE\\s+TRAN(?:SACTION)?\\b|SET\\s+IMPLICIT_TRANSACTIONS\\b)',
);

interface LexerRules {
    nestedComments: boolean;
    hashComments: boolean;
    dashesNeedSpace: boolean;
    executableComments: boolean;
    dollarQuotes: boolean;
    eStrings: boolean;
    brackets: boolean;
    bracketEscape: boolean;
    backticks: boolean;
}

// Each rule masks only what the dialect manual says it masks; masking more hides controls.
const LEXER_RULES: Record<Dialect, LexerRules> = {
    postgres: {
        nestedComments: true, hashComments: false, dashesNeedSpace: false, executableComments: false, dollarQuotes: true, eStrings: true,
        brackets: false, bracketEscape: false, backticks: false,
    },
    mysql: {
        nestedComments: false, hashComments: true, dashesNeedSpace: true, executableComments: true, dollarQuotes: false, eStrings: false,
        brackets: false, bracketEscape: false, backticks: true,
    },
    sqlite: {
        nestedComments: false, hashComments: false, dashesNeedSpace: false, executableComments: false, dollarQuotes: false,
        eStrings: false, brackets: true, bracketEscape: false, backticks: true,
    },
    mssql: {
        nestedComments: true, hashComments: false, dashesNeedSpace: false, executableComments: false, dollarQuotes: false,
        eStrings: false, brackets: true, bracketEscape: true, backticks: false,
    },
};

// The session's sql_mode decides which quotes take backslash escapes, and a step can change it,
// so MySQL is read as default, ANSI_QUOTES (`"` is an identifier) and NO_BACKSLASH_ESCAPES.
const MYSQL_BACKSLASH_READINGS = ['\'"', '\'', ''];

const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF]*)?\$/y;

function isIdentifierChar(char: string): boolean {

    return /[\w$]/.test(char) || char.charCodeAt(0) > 127;

}

function blank(text: string): string {

    return text.replace(/[^\n]/g, ' ');

}

/** Mask literals and comments without changing statement boundaries. */
function maskSql(input: string, dialect: Dialect, backslashQuotes: string): string {

    const rules = LEXER_RULES[dialect];
    let result = '';
    let i = 0;
    let inExecutableComment = false;
    while (i < input.length) {

        const start = i;
        const c = input.charAt(i);
        const pair = input.slice(i, i + 2);
        let dollarTag: string | undefined;
        if (c === '$' && rules.dollarQuotes && !isIdentifierChar(input[i - 1] ?? '')) {

            DOLLAR_TAG.lastIndex = i;
            dollarTag = DOLLAR_TAG.exec(input)?.[0];

        }
        if (rules.executableComments && inExecutableComment && pair === '*/') {

            i += 2;
            inExecutableComment = false;

        }
        else if (rules.executableComments && input.startsWith('/*!', i)) {

            i += 3;
            while (/\d/.test(input[i] ?? '')) i++;
            inExecutableComment = true;

        }
        else if (
            (c === '-' && input[i + 1] === '-' && !(rules.dashesNeedSpace && (input[i + 2]?.charCodeAt(0) ?? 0) > 32))
            || (c === '#' && rules.hashComments)
        ) {

            i += 2;
            while (i < input.length && input[i] !== '\n') i++;

        }
        else if (pair === '/*') {

            i += 2;
            let depth = 1;
            while (i < input.length && depth) {

                const next = input.slice(i, i + 2);
                if (next === '/*' && rules.nestedComments) {

                    depth++; i += 2;

                }
                else if (next === '*/') {

                    depth--; i += 2;

                }
                else i++;

            }

        }
        else if (c === "'" || c === '"' || (c === '`' && rules.backticks) || (c === '[' && rules.brackets)) {

            const end = c === '[' ? ']' : c;
            const isEscapeString = rules.eStrings && c === "'"
                && input[i - 1]?.toUpperCase() === 'E' && !/\w/.test(input[i - 2] ?? '');
            const backslashEscapes = isEscapeString || backslashQuotes.includes(c);
            i++;
            while (i < input.length) {

                if (input[i] === '\\' && backslashEscapes) {

                    i += 2; continue;

                }
                if (input[i++] === end) {

                    const doubled = end === ']' ? rules.bracketEscape : true;
                    if (doubled && input[i] === end) {

                        i++; continue;

                    }
                    break;

                }

            }

        }
        else if (dollarTag) {

            const end = input.indexOf(dollarTag, i + dollarTag.length);
            i = end < 0 ? input.length : end + dollarTag.length;

        }
        else {

            result += c; i++; continue;

        }
        result += blank(input.slice(start, i));

    }

    return result;

}

/** Recognize direct transaction controls using the same bounded scanner as managed preflight. */
export function hasAuthorTransactionControl(body: string, dialect: Dialect): boolean {

    return scanPipelineSql(body, dialect, false);

}

/** Rejects SQL that could end the managed transaction; a fail-closed preflight, with runtime ownership checks as the proof. */
export function assertManagedPipelineSql(body: string, dialect: Dialect, transaction: PipelineTransaction): void {

    if (transaction !== 'none' && scanPipelineSql(body, dialect, true)) {

        throw invalidDefinition('transaction-control', 'Managed pipeline SQL contains transaction control or an implicit commit');

    }

}

function scanPipelineSql(body: string, dialect: Dialect, managed: boolean): boolean {

    const fragments = dialect === 'sqlite' ? splitSqliteStatements(body) : [body];
    const readings = dialect === 'mysql' ? MYSQL_BACKSLASH_READINGS : [''];
    const maskedFragments = fragments.flatMap((fragment) => readings.map((quotes) => maskSql(fragment, dialect, quotes)));
    for (const masked of maskedFragments) {

        const statements = dialect === 'sqlite' ? [masked] : masked.split(/;|^\s*GO\s*$/im);
        for (const statement of statements) {

            const text = statement.trim().toUpperCase();
            let forbidden: boolean;
            if (dialect === 'mssql') {

                forbidden = MSSQL_TRANSACTION_CONTROL.test(text);

            }
            else {

                forbidden = /^(?:BEGIN\b|START\s+TRANSACTION\b|COMMIT\b|ROLLBACK\b|SAVEPOINT\b|RELEASE\s+SAVEPOINT\b)/.test(text)
                    || (dialect === 'postgres' && /^(?:END\b|ABORT\b|PREPARE\s+TRANSACTION\b)/.test(text))
                    || (dialect === 'sqlite' && /^(?:END\b|RELEASE\b)/.test(text))
                    || (dialect === 'mysql' && (
                        (managed
                            && /^(?:CREATE\b|ALTER\b|DROP\b|TRUNCATE\b|RENAME\b|LOCK\s+TABLES\b|UNLOCK\s+TABLES\b)/.test(text))
                        || /^(?:SET\s+(?:(?:SESSION|GLOBAL|LOCAL)\s+)?(?:@@(?:SESSION\.|GLOBAL\.|LOCAL\.)?)?AUTOCOMMIT\b|XA\b)/.test(text)
                    ));

            }
            if (forbidden) return true;

        }

    }

    return false;

}
