const MAX_HISTORY_LIMIT = 100;
const WHOLE_NUMBER = /^[1-9]\d*$/;

/** Whether a number is a storable pipeline run ID. */
export function isRunId(value: number): boolean {

    return Number.isSafeInteger(value) && value > 0;

}

/** Whether a number is an accepted history page size. */
export function isHistoryLimit(value: number): boolean {

    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_HISTORY_LIMIT;

}

/** Parses typed text into a run ID, so CLI and TUI accept the same inputs. */
export function parseRunId(value: unknown): number | null {

    if (typeof value !== 'string' || !WHOLE_NUMBER.test(value)) return null;
    const id = Number(value);

    return isRunId(id) ? id : null;

}

/** Parses typed text into a history limit (1-100). */
export function parseHistoryLimit(value: unknown): number | null {

    if (typeof value !== 'string' || !WHOLE_NUMBER.test(value)) return null;
    const limit = Number(value);

    return isHistoryLimit(limit) ? limit : null;

}

/** Whether text can name a pipeline folder: one relative segment, no separators, drive colon or NUL. */
export function isPipelineSlug(value: unknown): value is string {

    return typeof value === 'string' && value.length > 0 && !/[/\\:\0]/.test(value) && value !== '.' && value !== '..';

}
