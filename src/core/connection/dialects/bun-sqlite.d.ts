/**
 * Minimal type declarations for bun:sqlite.
 *
 * Avoids requiring full bun-types as a dependency.
 * Only declares the subset of the API used by the adapter.
 */
declare module 'bun:sqlite' {

    export class Database {

        constructor(filename: string, options?: { create?: boolean; readwrite?: boolean; readonly?: boolean });

        close(): void;
        prepare<T = Record<string, unknown>>(sql: string): Statement<T>;
        exec(sql: string): void;

    }

    export class Statement<T = Record<string, unknown>> {

        all(...params: unknown[]): T[];
        run(...params: unknown[]): { changes: number; lastInsertRowid: number };
        get(...params: unknown[]): T | undefined;
        values(...params: unknown[]): unknown[][];
        columnNames: string[];

    }

}
