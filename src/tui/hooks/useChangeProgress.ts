/**
 * Hook for tracking change execution progress via observer events.
 *
 * Subscribes to change:start, change:complete, change:file, and file:progress
 * events, maintaining state for results list, current change name, progress
 * counter, per-file progress, and the running file's server report.
 *
 * @example
 * ```tsx
 * const { results, currentChange, progress, currentFile, reset } = useChangeProgress();
 * reset(pendingChanges.length);
 * // ... results and progress update automatically via observer
 * ```
 */
import { useState, useCallback } from 'react';

import type { StatusListItem } from '../components/lists/index.js';
import type { NoormEvents } from '../../core/observer.js';
import { useOnEvent } from './useObserver.js';

/**
 * Return type for useChangeProgress.
 */
export interface ChangeProgressState {
    /** Accumulated results from change:complete events */
    results: StatusListItem[];

    /** Name of the currently executing change */
    currentChange: string;

    /** Progress counter */
    progress: { current: number; total: number };

    /** Currently executing file path */
    currentFile: string;

    /** File-level progress within current change */
    fileProgress: { current: number; total: number };

    /** Latest server report on the current file, once it has run past the watch delay */
    statement: NoormEvents['file:progress'] | null;

    /** Reset state for a new batch with given total */
    reset: (total: number) => void;
}

/**
 * Track change execution progress via observer events.
 *
 * Subscribes to change:start, change:complete, change:file, and file:progress,
 * returning reactive state that updates as changes execute.
 *
 * @example
 * ```tsx
 * const { results, currentChange, progress, currentFile, reset } = useChangeProgress();
 *
 * // Before starting execution
 * reset(changesToApply.length);
 *
 * // In render
 * <Text>{progress.current}/{progress.total} - {currentChange}</Text>
 * <Text dimColor>{fileProgress.current}/{fileProgress.total} - {currentFile}</Text>
 * <StatusList items={results} />
 * ```
 */
export function useChangeProgress(): ChangeProgressState {

    const [results, setResults] = useState<StatusListItem[]>([]);
    const [currentChange, setCurrentChange] = useState('');
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [currentFile, setCurrentFile] = useState('');
    const [fileProgress, setFileProgress] = useState({ current: 0, total: 0 });
    const [statement, setStatement] = useState<NoormEvents['file:progress'] | null>(null);

    useOnEvent('change:start', (data) => {

        setCurrentChange(data.name);

    }, []);

    useOnEvent('change:complete', (data) => {

        setResults((prev) => [
            ...prev,
            {
                key: data.name,
                label: data.name,
                status: data.status === 'success' ? 'success' : 'error',
                detail: `${data.durationMs}ms`,
            },
        ]);

        setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
        setStatement(null);

    }, []);

    useOnEvent('change:file', (data) => {

        setCurrentFile(data.filepath);
        setFileProgress({ current: data.index + 1, total: data.total });
        setStatement(null);

    }, []);

    useOnEvent('file:progress', (data) => {

        setStatement(data);

    }, []);

    const reset = useCallback((total: number) => {

        setResults([]);
        setCurrentChange('');
        setProgress({ current: 0, total });
        setCurrentFile('');
        setFileProgress({ current: 0, total: 0 });
        setStatement(null);

    }, []);

    return { results, currentChange, progress, currentFile, fileProgress, statement, reset };

}
