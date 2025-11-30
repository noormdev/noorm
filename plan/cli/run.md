# CLI Run Screens


## Overview

Run screens execute SQL files against the database:

- **List** - Overview of run options
- **Build** - Execute all files in schema directory
- **File** - Execute a single SQL file
- **Dir** - Execute all SQL files in a directory


## File Structure

```
src/cli/screens/run/
├── index.tsx              # Re-exports
├── list.tsx               # Run options overview
├── build.tsx              # Build schema screen
├── file.tsx               # Run single file screen
└── dir.tsx                # Run directory screen
```


## Run List Screen

```typescript
// src/cli/screens/run/list.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    SelectList,
    SelectListItem,
    Alert,
    Spinner
} from '../../components';
import { getStateManager } from '../../../core/state';
import { attempt } from '@logosdx/utils';

interface RunOption {
    key: string;
    label: string;
    description: string;
    route: string;
}

const RUN_OPTIONS: RunOption[] = [
    {
        key: 'build',
        label: 'Build Schema',
        description: 'Execute all files in schema directory',
        route: 'run/build',
    },
    {
        key: 'file',
        label: 'Run File',
        description: 'Execute a single SQL file',
        route: 'run/file',
    },
    {
        key: 'dir',
        label: 'Run Directory',
        description: 'Execute all SQL files in a directory',
        route: 'run/dir',
    },
];

export function RunListScreen() {

    const { navigate } = useRouter();
    const [loading, setLoading] = useState(true);
    const [hasConfig, setHasConfig] = useState(false);
    const [configName, setConfigName] = useState<string | null>(null);

    useEffect(() => {

        checkConfig();
    }, []);

    async function checkConfig() {

        const [stateManager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (stateManager) {

            const config = stateManager.getActiveConfig();
            setHasConfig(!!config);
            setConfigName(config?.name ?? null);
        }

        setLoading(false);
    }

    useScreenInput({
        'b': () => navigate('run/build'),
        'f': () => navigate('run/file'),
        'd': () => navigate('run/dir'),
        '1': () => navigate('run/build'),
        '2': () => navigate('run/file'),
        '3': () => navigate('run/dir'),
    }, [navigate]);

    if (loading) {

        return <Spinner label="Loading..." />;
    }

    if (!hasConfig) {

        return (
            <Box flexDirection="column">
                <Text bold>Run SQL</Text>
                <Box marginTop={1}>
                    <Alert
                        type="warning"
                        message="No active configuration. Please select a config first."
                    />
                </Box>
            </Box>
        );
    }

    const items: SelectListItem<RunOption>[] = RUN_OPTIONS.map(opt => ({
        key: opt.key,
        label: opt.label,
        value: opt,
        description: opt.description,
    }));

    return (
        <Box flexDirection="column">

            <Text bold>Run SQL</Text>
            <Text color="gray">Config: {configName}</Text>

            <Box marginTop={1}>
                <SelectList
                    items={items}
                    onSelect={(item) => navigate(item.value.route as any)}
                />
            </Box>

            <Footer
                actions={[
                    { key: 'b', label: 'build' },
                    { key: 'f', label: 'file' },
                    { key: 'd', label: 'dir' },
                ]}
            />

        </Box>
    );
}

export default RunListScreen;
```


## Build Schema Screen

```typescript
// src/cli/screens/run/build.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Alert,
    Spinner,
    ProgressBar,
    StatusList,
    ProtectedConfirm,
    Confirm,
    Checkbox
} from '../../components';
import { useProgress } from '../../hooks/useProgress';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { Runner, BuildResult, FileResult } from '../../../core/runner';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';

type Phase = 'options' | 'confirm' | 'running' | 'done' | 'error';

interface BuildOptions {
    force: boolean;
    dryRun: boolean;
}

export function RunBuildScreen() {

    const { navigate, back } = useRouter();

    const [phase, setPhase] = useState<Phase>('options');
    const [config, setConfig] = useState<Config | null>(null);
    const [options, setOptions] = useState<BuildOptions>({
        force: process.env.NOORM_FORCE === '1',
        dryRun: process.env.NOORM_DRY_RUN === '1',
    });
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<BuildResult | null>(null);

    const progress = useProgress();

    useEffect(() => {

        loadConfig();
    }, []);

    async function loadConfig() {

        const [stateManager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!stateManager) {

            setPhase('error');
            setError('Failed to load state');
            return;
        }

        const cfg = stateManager.getActiveConfig();

        if (!cfg) {

            setPhase('error');
            setError('No active configuration');
            return;
        }

        setConfig(cfg);
    }

    function handleContinue() {

        if (config?.protected && !options.dryRun) {

            setPhase('confirm');
        }
        else {

            runBuild();
        }
    }

    async function runBuild() {

        setPhase('running');

        const [conn, connErr] = await attempt(() =>
            createConnection(config!.connection, config!.name)
        );

        if (connErr) {

            setPhase('error');
            setError(`Connection failed: ${connErr.message}`);
            return;
        }

        const runner = new Runner(conn!.db, config!);

        // Ensure tracking table exists
        await runner.getTracker().ensureTable();

        const [buildResult, buildErr] = await attempt(() =>
            runner.build({
                force: options.force,
                dryRun: options.dryRun,
            })
        );

        await conn!.destroy();

        if (buildErr) {

            setPhase('error');
            setError(buildErr.message);
            return;
        }

        setResult(buildResult!);
        setPhase('done');
    }

    useScreenInput({
        'f': () => setOptions(prev => ({ ...prev, force: !prev.force })),
        'd': () => setOptions(prev => ({ ...prev, dryRun: !prev.dryRun })),
        'enter': () => {

            if (phase === 'options') handleContinue();
            if (phase === 'done') navigate('run');
        },
    }, [phase, options, config]);

    // Error state
    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Text bold>Build Schema</Text>
                <Box marginTop={1}>
                    <Alert type="error" message={error!} />
                </Box>
                <Text color="gray" marginTop={1}>Press Esc to go back</Text>
            </Box>
        );
    }

    // Options selection
    if (phase === 'options') {

        if (!config) {

            return <Spinner label="Loading configuration..." />;
        }

        return (
            <Box flexDirection="column">

                <Text bold>Build Schema</Text>
                <Text color="gray">Path: {config.paths.schema}</Text>

                <Box marginTop={1} flexDirection="column">
                    <Text>Options:</Text>

                    <Box marginTop={1} flexDirection="column">
                        <Box>
                            <Text color={options.force ? 'cyan' : 'gray'}>
                                [{options.force ? 'x' : ' '}] Force re-run all files
                            </Text>
                            <Text color="gray"> (f)</Text>
                        </Box>

                        <Box>
                            <Text color={options.dryRun ? 'cyan' : 'gray'}>
                                [{options.dryRun ? 'x' : ' '}] Dry run (no execution)
                            </Text>
                            <Text color="gray"> (d)</Text>
                        </Box>
                    </Box>
                </Box>

                {config.protected && !options.dryRun && (
                    <Box marginTop={1}>
                        <Text color="yellow">
                            {'\u26a0'} Protected config - will require confirmation
                        </Text>
                    </Box>
                )}

                <Footer
                    actions={[
                        { key: 'f', label: 'toggle force' },
                        { key: 'd', label: 'toggle dry-run' },
                        { key: 'enter', label: 'start' },
                    ]}
                />

            </Box>
        );
    }

    // Protected confirmation
    if (phase === 'confirm' && config?.protected) {

        return (
            <Box flexDirection="column">
                <Text bold>Build Schema</Text>
                <Box marginTop={1}>
                    <ProtectedConfirm
                        configName={config.name}
                        action="build schema"
                        onConfirm={runBuild}
                        onCancel={back}
                    />
                </Box>
            </Box>
        );
    }

    // Running
    if (phase === 'running') {

        return (
            <Box flexDirection="column">
                <Text bold>Building Schema{options.dryRun ? ' (Dry Run)' : ''}...</Text>

                <Box marginTop={1}>
                    {progress ? (
                        <ProgressBar
                            current={progress.current}
                            total={progress.total}
                            label={progress.message}
                        />
                    ) : (
                        <Spinner label="Starting build..." />
                    )}
                </Box>
            </Box>
        );
    }

    // Done
    if (phase === 'done' && result) {

        const isSuccess = result.status === 'success';

        // Prepare status items for display
        const displayItems = result.results.slice(0, 10).map(r => ({
            key: r.filepath,
            label: r.filepath.split('/').pop() ?? r.filepath,
            status: r.status === 'skipped' ? 'skipped' as const : r.status,
            detail: r.skipped
                ? r.skipReason
                : r.error ?? `${Math.round(r.durationMs ?? 0)}ms`,
        }));

        return (
            <Box flexDirection="column">

                <Text bold>Build Schema - {options.dryRun ? 'Dry Run ' : ''}Complete</Text>

                <Box marginTop={1}>
                    <Alert
                        type={isSuccess ? 'success' : 'error'}
                        title={isSuccess ? 'Success' : 'Failed'}
                        message={`${result.filesRun} run, ${result.filesSkipped} skipped, ${result.filesFailed} failed (${Math.round(result.durationMs)}ms)`}
                    />
                </Box>

                {displayItems.length > 0 && (
                    <Box marginTop={1} flexDirection="column">
                        <Text bold>Files:</Text>
                        <StatusList items={displayItems} />

                        {result.results.length > 10 && (
                            <Text color="gray">
                                ... and {result.results.length - 10} more files
                            </Text>
                        )}
                    </Box>
                )}

                <Footer
                    actions={[
                        { key: 'enter', label: 'done' },
                    ]}
                />

            </Box>
        );
    }

    return <Spinner label="Loading..." />;
}

export default RunBuildScreen;
```


## Run File Screen

```typescript
// src/cli/screens/run/file.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Alert,
    Spinner,
    TextInput,
    ProtectedConfirm
} from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { Runner, FileResult } from '../../../core/runner';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';
import { existsSync } from 'fs';
import { resolve } from 'path';

type Phase = 'input' | 'confirm' | 'running' | 'done' | 'error';

export function RunFileScreen() {

    const { navigate, back } = useRouter();
    const { params } = useRoute();

    const [phase, setPhase] = useState<Phase>('input');
    const [config, setConfig] = useState<Config | null>(null);
    const [filePath, setFilePath] = useState(params.path ?? '');
    const [force, setForce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<FileResult | null>(null);

    useEffect(() => {

        loadConfig();
    }, []);

    useEffect(() => {

        // If path provided via params, start immediately
        if (params.path && config && !config.protected) {

            runFile();
        }
    }, [params.path, config]);

    async function loadConfig() {

        const [stateManager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!stateManager) {

            setPhase('error');
            setError('Failed to load state');
            return;
        }

        const cfg = stateManager.getActiveConfig();

        if (!cfg) {

            setPhase('error');
            setError('No active configuration');
            return;
        }

        setConfig(cfg);
    }

    function validateAndContinue() {

        if (!filePath.trim()) {

            setError('File path is required');
            return;
        }

        const absolutePath = resolve(filePath);

        if (!existsSync(absolutePath)) {

            setError(`File not found: ${absolutePath}`);
            return;
        }

        if (!filePath.endsWith('.sql') && !filePath.endsWith('.sql.eta')) {

            setError('File must be a .sql or .sql.eta file');
            return;
        }

        setError(null);

        if (config?.protected) {

            setPhase('confirm');
        }
        else {

            runFile();
        }
    }

    async function runFile() {

        setPhase('running');

        const [conn, connErr] = await attempt(() =>
            createConnection(config!.connection, config!.name)
        );

        if (connErr) {

            setPhase('error');
            setError(`Connection failed: ${connErr.message}`);
            return;
        }

        const runner = new Runner(conn!.db, config!);
        await runner.getTracker().ensureTable();

        const [fileResult, runErr] = await attempt(() =>
            runner.runFile(filePath, { force })
        );

        await conn!.destroy();

        if (runErr) {

            setPhase('error');
            setError(runErr.message);
            return;
        }

        setResult(fileResult!);
        setPhase('done');
    }

    useScreenInput({
        'f': () => setForce(prev => !prev),
        'enter': () => {

            if (phase === 'input') validateAndContinue();
            if (phase === 'done') navigate('run');
        },
    }, [phase, filePath, force]);

    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Text bold>Run File</Text>
                <Box marginTop={1}>
                    <Alert type="error" message={error!} />
                </Box>
                <Text color="gray" marginTop={1}>Press Esc to go back</Text>
            </Box>
        );
    }

    if (phase === 'input') {

        if (!config) {

            return <Spinner label="Loading..." />;
        }

        return (
            <Box flexDirection="column">

                <Text bold>Run File</Text>

                <Box marginTop={1}>
                    <TextInput
                        label="File path"
                        value={filePath}
                        onChange={(v) => {

                            setFilePath(v);
                            setError(null);
                        }}
                        onSubmit={validateAndContinue}
                        placeholder="./schema/001_create_users.sql"
                        error={error ?? undefined}
                    />
                </Box>

                <Box marginTop={1}>
                    <Text color={force ? 'cyan' : 'gray'}>
                        [{force ? 'x' : ' '}] Force re-run (ignore checksum)
                    </Text>
                    <Text color="gray"> (f)</Text>
                </Box>

                <Footer
                    actions={[
                        { key: 'f', label: 'toggle force' },
                        { key: 'enter', label: 'run' },
                    ]}
                />

            </Box>
        );
    }

    if (phase === 'confirm' && config?.protected) {

        return (
            <Box flexDirection="column">
                <Text bold>Run File: {filePath}</Text>
                <Box marginTop={1}>
                    <ProtectedConfirm
                        configName={config.name}
                        action={`run file "${filePath}"`}
                        onConfirm={runFile}
                        onCancel={back}
                    />
                </Box>
            </Box>
        );
    }

    if (phase === 'running') {

        return (
            <Box flexDirection="column">
                <Text bold>Running File...</Text>
                <Text color="gray">{filePath}</Text>
                <Box marginTop={1}>
                    <Spinner label="Executing SQL..." />
                </Box>
            </Box>
        );
    }

    if (phase === 'done' && result) {

        const isSuccess = result.status === 'success';
        const wasSkipped = result.skipped;

        return (
            <Box flexDirection="column">

                <Text bold>Run File - Complete</Text>

                <Box marginTop={1}>
                    {wasSkipped ? (
                        <Alert
                            type="info"
                            title="Skipped"
                            message={`File unchanged (${result.skipReason})`}
                        />
                    ) : (
                        <Alert
                            type={isSuccess ? 'success' : 'error'}
                            title={isSuccess ? 'Success' : 'Failed'}
                            message={
                                isSuccess
                                    ? `Executed in ${Math.round(result.durationMs ?? 0)}ms`
                                    : result.error ?? 'Unknown error'
                            }
                        />
                    )}
                </Box>

                <Footer
                    actions={[
                        { key: 'enter', label: 'done' },
                    ]}
                />

            </Box>
        );
    }

    return <Spinner label="Loading..." />;
}

export default RunFileScreen;
```


## Run Directory Screen

```typescript
// src/cli/screens/run/dir.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Alert,
    Spinner,
    ProgressBar,
    StatusList,
    TextInput,
    ProtectedConfirm
} from '../../components';
import { useProgress } from '../../hooks/useProgress';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { Runner, DirResult } from '../../../core/runner';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

type Phase = 'input' | 'confirm' | 'running' | 'done' | 'error';

export function RunDirScreen() {

    const { navigate, back } = useRouter();
    const { params } = useRoute();

    const [phase, setPhase] = useState<Phase>('input');
    const [config, setConfig] = useState<Config | null>(null);
    const [dirPath, setDirPath] = useState(params.path ?? '');
    const [force, setForce] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<DirResult | null>(null);

    const progress = useProgress();

    useEffect(() => {

        loadConfig();
    }, []);

    async function loadConfig() {

        const [stateManager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!stateManager) {

            setPhase('error');
            setError('Failed to load state');
            return;
        }

        const cfg = stateManager.getActiveConfig();

        if (!cfg) {

            setPhase('error');
            setError('No active configuration');
            return;
        }

        setConfig(cfg);
    }

    function validateAndContinue() {

        if (!dirPath.trim()) {

            setError('Directory path is required');
            return;
        }

        const absolutePath = resolve(dirPath);

        if (!existsSync(absolutePath)) {

            setError(`Directory not found: ${absolutePath}`);
            return;
        }

        const stats = statSync(absolutePath);

        if (!stats.isDirectory()) {

            setError('Path is not a directory');
            return;
        }

        setError(null);

        if (config?.protected) {

            setPhase('confirm');
        }
        else {

            runDir();
        }
    }

    async function runDir() {

        setPhase('running');

        const [conn, connErr] = await attempt(() =>
            createConnection(config!.connection, config!.name)
        );

        if (connErr) {

            setPhase('error');
            setError(`Connection failed: ${connErr.message}`);
            return;
        }

        const runner = new Runner(conn!.db, config!);
        await runner.getTracker().ensureTable();

        const [dirResult, runErr] = await attempt(() =>
            runner.runDir(dirPath, { force })
        );

        await conn!.destroy();

        if (runErr) {

            setPhase('error');
            setError(runErr.message);
            return;
        }

        setResult(dirResult!);
        setPhase('done');
    }

    useScreenInput({
        'f': () => setForce(prev => !prev),
        'enter': () => {

            if (phase === 'input') validateAndContinue();
            if (phase === 'done') navigate('run');
        },
    }, [phase, dirPath, force]);

    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Text bold>Run Directory</Text>
                <Box marginTop={1}>
                    <Alert type="error" message={error!} />
                </Box>
                <Text color="gray" marginTop={1}>Press Esc to go back</Text>
            </Box>
        );
    }

    if (phase === 'input') {

        if (!config) {

            return <Spinner label="Loading..." />;
        }

        return (
            <Box flexDirection="column">

                <Text bold>Run Directory</Text>

                <Box marginTop={1}>
                    <TextInput
                        label="Directory path"
                        value={dirPath}
                        onChange={(v) => {

                            setDirPath(v);
                            setError(null);
                        }}
                        onSubmit={validateAndContinue}
                        placeholder="./migrations"
                        error={error ?? undefined}
                    />
                </Box>

                <Box marginTop={1}>
                    <Text color={force ? 'cyan' : 'gray'}>
                        [{force ? 'x' : ' '}] Force re-run all files
                    </Text>
                    <Text color="gray"> (f)</Text>
                </Box>

                <Footer
                    actions={[
                        { key: 'f', label: 'toggle force' },
                        { key: 'enter', label: 'run' },
                    ]}
                />

            </Box>
        );
    }

    if (phase === 'confirm' && config?.protected) {

        return (
            <Box flexDirection="column">
                <Text bold>Run Directory: {dirPath}</Text>
                <Box marginTop={1}>
                    <ProtectedConfirm
                        configName={config.name}
                        action={`run all files in "${dirPath}"`}
                        onConfirm={runDir}
                        onCancel={back}
                    />
                </Box>
            </Box>
        );
    }

    if (phase === 'running') {

        return (
            <Box flexDirection="column">
                <Text bold>Running Directory...</Text>
                <Text color="gray">{dirPath}</Text>

                <Box marginTop={1}>
                    {progress ? (
                        <ProgressBar
                            current={progress.current}
                            total={progress.total}
                            label={progress.message}
                        />
                    ) : (
                        <Spinner label="Scanning files..." />
                    )}
                </Box>
            </Box>
        );
    }

    if (phase === 'done' && result) {

        const isSuccess = result.status === 'success';

        const displayItems = result.results.slice(0, 10).map(r => ({
            key: r.filepath,
            label: r.filepath.split('/').pop() ?? r.filepath,
            status: r.status === 'skipped' ? 'skipped' as const : r.status,
            detail: r.skipped
                ? r.skipReason
                : r.error ?? `${Math.round(r.durationMs ?? 0)}ms`,
        }));

        return (
            <Box flexDirection="column">

                <Text bold>Run Directory - Complete</Text>

                <Box marginTop={1}>
                    <Alert
                        type={isSuccess ? 'success' : 'error'}
                        title={isSuccess ? 'Success' : 'Failed'}
                        message={`${result.filesRun} run, ${result.filesSkipped} skipped, ${result.filesFailed} failed (${Math.round(result.durationMs)}ms)`}
                    />
                </Box>

                {displayItems.length > 0 && (
                    <Box marginTop={1} flexDirection="column">
                        <Text bold>Files:</Text>
                        <StatusList items={displayItems} />

                        {result.results.length > 10 && (
                            <Text color="gray">
                                ... and {result.results.length - 10} more files
                            </Text>
                        )}
                    </Box>
                )}

                <Footer
                    actions={[
                        { key: 'enter', label: 'done' },
                    ]}
                />

            </Box>
        );
    }

    return <Spinner label="Loading..." />;
}

export default RunDirScreen;
```


## Index Exports

```typescript
// src/cli/screens/run/index.tsx

export { default as list } from './list';
export { default as build } from './build';
export { default as file } from './file';
export { default as dir } from './dir';
```


## Screen Summary

| Screen | Route | Purpose |
|--------|-------|---------|
| List | `run` | Overview of run options |
| Build | `run/build` | Execute schema directory |
| File | `run/file` | Execute single SQL file |
| Dir | `run/dir` | Execute directory of SQL files |


## Keyboard Reference

### List Screen

| Key | Action |
|-----|--------|
| `b` | Go to Build screen |
| `f` | Go to File screen |
| `d` | Go to Dir screen |
| `1-3` | Quick navigate |

### Build/Dir Screens

| Key | Action |
|-----|--------|
| `f` | Toggle force option |
| `d` | Toggle dry-run option |
| `Enter` | Start execution / Continue |

### File Screen

| Key | Action |
|-----|--------|
| `f` | Toggle force option |
| `Enter` | Run file / Continue |


## Progress Integration

The run screens use the `useProgress` hook to display real-time progress:

```typescript
import { useProgress } from '../../hooks/useProgress';

function BuildScreen() {

    const progress = useProgress();

    // progress = { current: 5, total: 20, message: "Building schema..." }

    return (
        <ProgressBar
            current={progress?.current ?? 0}
            total={progress?.total ?? 0}
            label={progress?.message}
        />
    );
}
```

The hook subscribes to observer events:
- `build:start` - Sets total files
- `file:after` / `file:skip` - Increments current
- `build:complete` - Clears progress
