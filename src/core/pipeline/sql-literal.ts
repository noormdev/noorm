import { sqlQuote } from '../template/utils.js';

type QuoteValue = string | number | boolean | null | undefined;

/** Thrown by `$.escape` in a pipeline render; its text is fixed so it can never carry the input. */
export class PipelineEscapeError extends Error {

    constructor() {

        super('$.escape is not available in pipelines; use $.quote, which is correct under every session mode');
        this.name = 'PipelineEscapeError';

    }

}

/** Pipelines provide no escape: no content encoding inside an author-written literal is correct under both MySQL backslash modes. */
export function pipelineEscape(): never {

    throw new PipelineEscapeError();

}

/** MySQL's UTF-8 hex literal is independent of backslash SQL modes. */
export function mysqlPipelineQuote(value: QuoteValue): string {

    return typeof value === 'string' ? `_utf8mb4 X'${Buffer.from(value, 'utf8').toString('hex')}'` : sqlQuote(value);

}

/** Every code point is a U& escape, so the literal fails closed (0A000) when standard_conforming_strings is off. */
export function postgresPipelineQuote(value: QuoteValue): string {

    if (typeof value !== 'string') return sqlQuote(value);

    let body = '';
    for (const char of value) {

        const point = (char.codePointAt(0) ?? 0).toString(16).toUpperCase();
        body += point.length > 4 ? `\\+${point.padStart(6, '0')}` : `\\${point.padStart(4, '0')}`;

    }

    return `U&'${body}'`;

}

/** N'' keeps Unicode. T-SQL drops `\` + LF/CRLF as a line continuation, and only the `\` before a lone CR. */
export function mssqlPipelineQuote(value: QuoteValue): string {

    if (typeof value !== 'string') return sqlQuote(value);

    const keepContinuation = (_: string, lineBreak: string) => `\\\\${lineBreak}${lineBreak.endsWith('\n') ? lineBreak : ''}`;

    return `N${sqlQuote(value).replace(/\\(\r?\n|\r)/g, keepContinuation)}`;

}
