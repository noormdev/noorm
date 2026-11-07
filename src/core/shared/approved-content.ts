import { AsyncLocalStorage } from 'node:async_hooks';

/** Private execution scope established only by the MCP approval server. */
export interface ApprovedContent {
    sql: ReadonlyMap<string, string>;
    checksums: ReadonlyMap<string, string>;
    buildFiles?: readonly string[];
    changes?: ReadonlyMap<string, string>;
    pending?: readonly string[];
}

export function changeFilePlan(files: readonly { path: string; type: string; resolvedPaths?: string[] }[]): string {

    return JSON.stringify(files.map((file) => [file.path, file.type, file.resolvedPaths ?? null]));

}

const approved = new AsyncLocalStorage<ApprovedContent>();

export function withApprovedContent<T>(content: ApprovedContent, action: () => Promise<T>): Promise<T> {

    return approved.run(content, action);

}

export function approvedSql(filepath: string): string | undefined {

    const scope = approved.getStore();
    if (!scope) return undefined;
    const sql = scope.sql.get(filepath);
    if (sql === undefined) throw new Error(`File was not included in the approved plan: ${filepath}`);

    return sql;

}

export function approvedChecksum(filepath: string): string | undefined {

    const scope = approved.getStore();
    if (!scope) return undefined;
    const checksum = scope.checksums.get(filepath);
    if (checksum === undefined) throw new Error(`File was not included in the approved plan: ${filepath}`);

    return checksum;

}

export function assertApprovedBuild(files: readonly string[]): void {

    const scope = approved.getStore();
    if (scope && JSON.stringify(files) !== JSON.stringify(scope.buildFiles)) {

        throw new Error('Build file plan changed since approval');

    }

}
export function assertApprovedChange(
    name: string,
    direction: string,
    files: readonly { path: string; type: string; resolvedPaths?: string[] }[],
): void {

    const scope = approved.getStore();
    if (scope && scope.changes?.get(`${direction}:${name}`) !== changeFilePlan(files)) {

        throw new Error(`Change plan changed since approval: ${name}`);

    }

}

export function assertApprovedPending(names: readonly string[]): void {

    const scope = approved.getStore();
    if (scope && JSON.stringify(names) !== JSON.stringify(scope.pending)) {

        throw new Error('Pending change plan changed since approval');

    }

}
