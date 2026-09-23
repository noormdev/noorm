/**
 * StatementProgress - what a long-running file is doing on the server.
 *
 * Renders the latest `file:progress` report: elapsed time, the operation's
 * own progress when the server reports it, and the sessions it is waiting on.
 * A blocked file and a slow file look the same without the second line.
 *
 * @example
 * ```tsx
 * {progress.statement && <StatementProgress report={progress.statement} />}
 * ```
 */
import { Box, Text } from 'ink';

import type { ReactElement } from 'react';
import type { NoormEvents } from '../../../core/observer.js';
import type { OperationProgress } from '../../../core/runner/index.js';

type StatementReport = NoormEvents['file:progress'];

export interface StatementProgressProps {
    report: StatementReport;
}

/**
 * `17m05s`, `1h02m`, `42s`.
 */
function formatElapsed(ms: number): string {

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
    if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;

    return `${seconds}s`;

}

function describeProgress(progress: OperationProgress): string {

    const parts = [progress.relation ? `${progress.operation} on ${progress.relation}` : progress.operation];

    if (progress.phase) parts.push(progress.phase);

    if (progress.done !== null && progress.total !== null) {

        const percent = progress.percent === null ? '' : ` (${Math.floor(progress.percent)}%)`;
        parts.push(`${progress.done}/${progress.total}${percent}`);

    }
    else if (progress.percent !== null) {

        parts.push(`${Math.floor(progress.percent)}%`);

    }

    return parts.join(' · ');

}

/**
 * Status lines for the file that is currently running.
 */
export function StatementProgress({ report }: StatementProgressProps): ReactElement {

    const { status } = report;
    const blocked = status?.blockedBy ?? [];
    const idleDetail = status && !status.progress && blocked.length === 0 ? status.waitEvent ?? status.state : null;

    return (
        <Box flexDirection="column">
            <Text>
                <Text dimColor>Running for </Text>
                <Text bold>{formatElapsed(report.elapsedMs)}</Text>
                {report.sessionId !== null && <Text dimColor>  pid {report.sessionId}</Text>}
                {idleDetail && <Text dimColor>  {idleDetail}</Text>}
            </Text>

            {status?.progress && (
                <Text color="cyan">
                    {describeProgress(status.progress)}
                    {status.workers > 0 && <Text dimColor>  {status.workers} parallel workers</Text>}
                </Text>
            )}

            {blocked.map((blocker) => (
                <Text key={blocker.pid} color="yellow" wrap="truncate">
                    Waiting on pid {blocker.pid}
                    {blocker.query && ` (${blocker.query.replace(/\s+/g, ' ')}`}
                    {blocker.query && blocker.ageMs !== null && `, ${formatElapsed(blocker.ageMs)}`}
                    {blocker.query && ')'}
                    {status?.waitEvent && ` · ${status.waitEvent}`}
                </Text>
            ))}
        </Box>
    );

}
