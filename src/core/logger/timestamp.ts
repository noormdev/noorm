/**
 * Log timestamp formatting.
 *
 * Native `Date` formatters for the two fixed, non-locale,
 * non-timezone-conversion formats the logger writes on every entry —
 * avoids pulling in dayjs on the per-line hot path.
 */

/**
 * Format a Date as `YY-MM-DD HH:mm:ss` (local time) — the console log
 * line timestamp.
 *
 * @example
 * formatLogTimestamp(new Date(2024, 0, 15, 10, 30, 0)); // '24-01-15 10:30:00'
 */
export function formatLogTimestamp(d: Date): string {

    const year = String(d.getFullYear()).slice(-2);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

}

/**
 * Format a Date as `YYYY-MM-DDTHH:mm:ss.SSS±HH:mm` (local time with UTC
 * offset) — the JSON log entry's `time` field.
 *
 * The offset is the local UTC offset, not a literal `Z` suffix.
 * `Date#getTimezoneOffset()` returns UTC-minus-local in minutes (positive
 * when local is behind UTC), so the sign is flipped relative to it.
 *
 * @example
 * formatLogTimestampIso(new Date(Date.UTC(2024, 0, 15, 10, 30, 0, 123))); // '2024-01-15T10:30:00.123+00:00' in UTC
 */
export function formatLogTimestampIso(d: Date): string {

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const millis = String(d.getMilliseconds()).padStart(3, '0');

    const offset = d.getTimezoneOffset();
    const sign = offset <= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
    const offsetMinutes = String(absOffset % 60).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetMinutes}`;

}
