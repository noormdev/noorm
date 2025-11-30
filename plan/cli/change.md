# CLI Change Screens


## Overview

Change screens manage database changesets:

- **List** - View all changesets with status
- **Add** - Create new changeset folder
- **Edit** - Open changeset in editor
- **Remove** - Delete changeset
- **Run** - Apply specific changeset
- **Revert** - Rollback specific changeset
- **Next** - Apply next N pending changesets
- **FF** - Fast-forward all pending changesets


## File Structure

```
src/cli/screens/change/
├── index.tsx              # Re-exports
├── list.tsx               # Changeset list screen
├── add.tsx                # Create changeset screen
├── edit.tsx               # Edit changeset screen
├── rm.tsx                 # Remove changeset screen
├── run.tsx                # Run changeset screen
├── revert.tsx             # Revert changeset screen
├── next.tsx               # Apply next N screen
└── ff.tsx                 # Fast-forward screen
```


## Changeset List Screen

```typescript
// src/cli/screens/change/list.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    SelectList,
    SelectListItem,
    Badge,
    Spinner,
    Alert,
    Divider
} from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { ChangesetManager, Changeset, ChangesetStatus } from '../../../core/changeset';
import { attempt } from '@logosdx/utils';

type ChangesetWithStatus = Changeset & { status: ChangesetStatus };

interface ChangeListState {
    loading: boolean;
    changesets: ChangesetWithStatus[];
    selectedIndex: number;
    error: string | null;
    noConfig: boolean;
}

export function ChangeListScreen() {

    const { navigate, back } = useRouter();
    const [state, setState] = useState<ChangeListState>({
        loading: true,
        changesets: [],
        selectedIndex: 0,
        error: null,
        noConfig: false,
    });

    useEffect(() => {

        loadChangesets();
    }, []);

    async function loadChangesets() {

        const [stateManager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!stateManager) {

            setState(prev => ({ ...prev, loading: false, error: 'Failed to load state' }));
            return;
        }

        const config = stateManager.getActiveConfig();

        if (!config) {

            setState(prev => ({ ...prev, loading: false, noConfig: true }));
            return;
        }

        const [conn, connErr] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (connErr) {

            setState(prev => ({
                ...prev,
                loading: false,
                error: `Connection failed: ${connErr.message}`
            }));
            return;
        }

        const manager = new ChangesetManager(conn!.db, config);
        const [changesets, listErr] = await attempt(() => manager.list());

        await conn!.destroy();

        if (listErr) {

            setState(prev => ({
                ...prev,
                loading: false,
                error: listErr.message
            }));
            return;
        }

        setState({
            loading: false,
            changesets: changesets!,
            selectedIndex: 0,
            error: null,
            noConfig: false,
        });
    }

    useScreenInput({
        'a': () => navigate('change/add'),
        'e': () => {

            const selected = state.changesets[state.selectedIndex];
            if (selected) {

                navigate('change/edit', { name: selected.name });
            }
        },
        'd': () => {

            const selected = state.changesets[state.selectedIndex];
            if (selected) {

                navigate('change/rm', { name: selected.name });
            }
        },
        'r': () => {

            const selected = state.changesets[state.selectedIndex];
            if (selected && !selected.status.applied) {

                navigate('change/run', { name: selected.name });
            }
        },
        'v': () => {

            const selected = state.changesets[state.selectedIndex];
            if (selected && selected.status.applied) {

                navigate('change/revert', { name: selected.name });
            }
        },
        'n': () => navigate('change/next'),
        'f': () => navigate('change/ff'),
    }, [state.changesets, state.selectedIndex, navigate]);

    if (state.loading) {

        return <Spinner label="Loading changesets..." />;
    }

    if (state.noConfig) {

        return (
            <Box flexDirection="column">
                <Alert type="warning" message="No active configuration. Please select a config first." />
                <Text color="gray" marginTop={1}>Press Esc to go back</Text>
            </Box>
        );
    }

    if (state.error) {

        return <Alert type="error" message={state.error} />;
    }

    const pending = state.changesets.filter(c => !c.status.applied);
    const applied = state.changesets.filter(c => c.status.applied);

    const items: SelectListItem<ChangesetWithStatus>[] = state.changesets.map(cs => ({
        key: cs.name,
        label: cs.name,
        value: cs,
        icon: cs.status.applied ? '\u2713' : '\u25cb',
        description: cs.status.applied
            ? `applied ${formatDate(cs.status.appliedAt)}`
            : 'pending',
    }));

    return (
        <Box flexDirection="column">

            <Text bold>Changesets</Text>

            <Box marginTop={1} gap={2}>
                <Text color="gray">
                    Total: {state.changesets.length}
                </Text>
                <Text color="green">
                    Applied: {applied.length}
                </Text>
                <Text color="yellow">
                    Pending: {pending.length}
                </Text>
            </Box>

            <Box marginTop={1}>
                {items.length === 0 ? (
                    <Box flexDirection="column">
                        <Text color="gray">No changesets found.</Text>
                        <Text color="gray" marginTop={1}>
                            Press <Text color="yellow">a</Text> to create your first changeset.
                        </Text>
                    </Box>
                ) : (
                    <SelectList
                        items={items}
                        onSelect={(item) => {

                            if (item.value.status.applied) {

                                navigate('change/revert', { name: item.value.name });
                            }
                            else {

                                navigate('change/run', { name: item.value.name });
                            }
                        }}
                        onHighlight={(item) => {

                            const idx = state.changesets.findIndex(c => c.name === item.value.name);
                            setState(prev => ({ ...prev, selectedIndex: idx }));
                        }}
                    />
                )}
            </Box>

            {pending.length > 0 && (
                <Box marginTop={1}>
                    <Text color="cyan">
                        Tip: Press <Text bold>f</Text> to fast-forward all {pending.length} pending changesets
                    </Text>
                </Box>
            )}

            <Footer
                actions={[
                    { key: 'a', label: 'add' },
                    { key: 'r', label: 'run' },
                    { key: 'v', label: 'revert' },
                    { key: 'n', label: 'next' },
                    { key: 'f', label: 'ff' },
                ]}
            />

        </Box>
    );
}

function formatDate(date: Date | null): string {

    if (!date) return '';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}

export default ChangeListScreen;
```


## Add Changeset Screen

```typescript
// src/cli/screens/change/add.tsx

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    TextInput,
    Alert,
    Spinner
} from '../../components';
import { getStateManager } from '../../../core/state';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { attempt } from '@logosdx/utils';

export function ChangeAddScreen() {

    const { navigate, back } = useRouter();
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleCreate() {

        if (!name.trim()) {

            setError('Name is required');
            return;
        }

        setCreating(true);

        const [stateManager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!stateManager) {

            setError('Failed to load state');
            setCreating(false);
            return;
        }

        const config = stateManager.getActiveConfig();

        if (!config) {

            setError('No active configuration');
            setCreating(false);
            return;
        }

        // Generate name with date prefix
        const today = new Date().toISOString().split('T')[0];
        const sanitizedName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const fullName = `${today}_${sanitizedName}`;

        const changesetPath = resolve(config.paths.changesets, fullName);
        const changePath = join(changesetPath, 'change');
        const revertPath = join(changesetPath, 'revert');

        // Create directories
        const [, mkdirErr] = await attempt(async () => {

            await mkdir(changePath, { recursive: true });
            await mkdir(revertPath, { recursive: true });
        });

        if (mkdirErr) {

            setError(`Failed to create directories: ${mkdirErr.message}`);
            setCreating(false);
            return;
        }

        // Create placeholder files
        const [, writeErr] = await attempt(async () => {

            await writeFile(
                join(changePath, '001_change.sql'),
                `-- Changeset: ${fullName}\n-- Description: ${name}\n\n-- Add your SQL here\n`
            );

            await writeFile(
                join(revertPath, '001_revert.sql'),
                `-- Revert: ${fullName}\n-- Description: Undo ${name}\n\n-- Add your revert SQL here\n`
            );
        });

        if (writeErr) {

            setError(`Failed to create files: ${writeErr.message}`);
            setCreating(false);
            return;
        }

        navigate('change');
    }

    useScreenInput({
        'enter': handleCreate,
    }, [name]);

    if (creating) {

        return <Spinner label="Creating changeset..." />;
    }

    return (
        <Box flexDirection="column">

            <Text bold>Create Changeset</Text>

            <Box marginTop={1}>
                <TextInput
                    label="Changeset name"
                    value={name}
                    onChange={(v) => {

                        setName(v);
                        setError(null);
                    }}
                    onSubmit={handleCreate}
                    placeholder="e.g., add user roles"
                />
            </Box>

            <Box marginTop={1}>
                <Text color="gray">
                    Will create: {new Date().toISOString().split('T')[0]}_{name.toLowerCase().replace(/\s+/g, '-') || 'changeset-name'}
                </Text>
            </Box>

            {error && (
                <Box marginTop={1}>
                    <Alert type="error" message={error} />
                </Box>
            )}

            <Footer
                actions={[
                    { key: 'enter', label: 'create' },
                ]}
            />

        </Box>
    );
}

export default ChangeAddScreen;
```


## Run Changeset Screen

```typescript
// src/cli/screens/change/run.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import {
    Footer,
    Alert,
    Spinner,
    ProgressBar,
    StatusList,
    ProtectedConfirm
} from '../../components';
import { useProgress } from '../../hooks/useProgress';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { ChangesetManager } from '../../../core/changeset';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';

type Phase = 'confirm' | 'running' | 'done' | 'error';

interface RunState {
    phase: Phase;
    config: Config | null;
    error: string | null;
    result: {
        filesExecuted: number;
        durationMs: number;
        status: 'success' | 'failed';
    } | null;
}

export function ChangeRunScreen() {

    const { navigate, back } = useRouter();
    const { params } = useRoute();
    const changesetName = params.name;

    const [state, setState] = useState<RunState>({
        phase: 'confirm',
        config: null,
        error: null,
        result: null,
    });

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

            setState(prev => ({ ...prev, phase: 'error', error: 'Failed to load state' }));
            return;
        }

        const config = stateManager.getActiveConfig();

        if (!config) {

            setState(prev => ({ ...prev, phase: 'error', error: 'No active configuration' }));
            return;
        }

        setState(prev => ({ ...prev, config }));

        // If not protected, start immediately
        if (!config.protected) {

            runChangeset(config);
        }
    }

    async function runChangeset(config: Config) {

        setState(prev => ({ ...prev, phase: 'running' }));

        const [conn, connErr] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (connErr) {

            setState(prev => ({
                ...prev,
                phase: 'error',
                error: `Connection failed: ${connErr.message}`
            }));
            return;
        }

        const manager = new ChangesetManager(conn!.db, config);
        await manager.ensureTables();

        const [result, runErr] = await attempt(() =>
            manager.run(changesetName!)
        );

        await conn!.destroy();

        if (runErr) {

            setState(prev => ({
                ...prev,
                phase: 'error',
                error: runErr.message
            }));
            return;
        }

        setState(prev => ({
            ...prev,
            phase: 'done',
            result: {
                filesExecuted: result!.filesExecuted,
                durationMs: result!.durationMs,
                status: result!.status,
            }
        }));
    }

    // Render based on phase
    if (state.phase === 'error') {

        return (
            <Box flexDirection="column">
                <Text bold>Run Changeset: {changesetName}</Text>
                <Box marginTop={1}>
                    <Alert type="error" message={state.error!} />
                </Box>
                <Text color="gray" marginTop={1}>Press Esc to go back</Text>
            </Box>
        );
    }

    if (state.phase === 'confirm' && state.config?.protected) {

        return (
            <Box flexDirection="column">
                <Text bold>Run Changeset: {changesetName}</Text>
                <Box marginTop={1}>
                    <ProtectedConfirm
                        configName={state.config.name}
                        action={`run changeset "${changesetName}"`}
                        onConfirm={() => runChangeset(state.config!)}
                        onCancel={back}
                    />
                </Box>
            </Box>
        );
    }

    if (state.phase === 'running') {

        return (
            <Box flexDirection="column">
                <Text bold>Running Changeset: {changesetName}</Text>

                <Box marginTop={1}>
                    {progress ? (
                        <ProgressBar
                            current={progress.current}
                            total={progress.total}
                            label={progress.message}
                        />
                    ) : (
                        <Spinner label="Starting..." />
                    )}
                </Box>
            </Box>
        );
    }

    if (state.phase === 'done' && state.result) {

        const isSuccess = state.result.status === 'success';

        return (
            <Box flexDirection="column">

                <Text bold>Run Changeset: {changesetName}</Text>

                <Box marginTop={1}>
                    <Alert
                        type={isSuccess ? 'success' : 'error'}
                        title={isSuccess ? 'Success' : 'Failed'}
                        message={
                            isSuccess
                                ? `Applied ${state.result.filesExecuted} files in ${Math.round(state.result.durationMs)}ms`
                                : 'Changeset failed to apply'
                        }
                    />
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

export default ChangeRunScreen;
```


## Revert Changeset Screen

```typescript
// src/cli/screens/change/revert.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import {
    Footer,
    Alert,
    Spinner,
    ProgressBar,
    ProtectedConfirm,
    Confirm
} from '../../components';
import { useProgress } from '../../hooks/useProgress';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { ChangesetManager } from '../../../core/changeset';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';

type Phase = 'confirm' | 'running' | 'done' | 'error';

export function ChangeRevertScreen() {

    const { navigate, back } = useRouter();
    const { params } = useRoute();
    const changesetName = params.name;

    const [phase, setPhase] = useState<Phase>('confirm');
    const [config, setConfig] = useState<Config | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ filesExecuted: number; durationMs: number; status: string } | null>(null);

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

    async function runRevert() {

        setPhase('running');

        const [conn, connErr] = await attempt(() =>
            createConnection(config!.connection, config!.name)
        );

        if (connErr) {

            setPhase('error');
            setError(`Connection failed: ${connErr.message}`);
            return;
        }

        const manager = new ChangesetManager(conn!.db, config!);
        await manager.ensureTables();

        const [res, revertErr] = await attempt(() =>
            manager.revert(changesetName!)
        );

        await conn!.destroy();

        if (revertErr) {

            setPhase('error');
            setError(revertErr.message);
            return;
        }

        setResult({
            filesExecuted: res!.filesExecuted,
            durationMs: res!.durationMs,
            status: res!.status,
        });
        setPhase('done');
    }

    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Text bold>Revert Changeset: {changesetName}</Text>
                <Box marginTop={1}>
                    <Alert type="error" message={error!} />
                </Box>
            </Box>
        );
    }

    if (phase === 'confirm') {

        if (!config) {

            return <Spinner label="Loading..." />;
        }

        if (config.protected) {

            return (
                <Box flexDirection="column">
                    <Text bold>Revert Changeset: {changesetName}</Text>
                    <Box marginTop={1}>
                        <ProtectedConfirm
                            configName={config.name}
                            action={`revert changeset "${changesetName}"`}
                            onConfirm={runRevert}
                            onCancel={back}
                        />
                    </Box>
                </Box>
            );
        }

        return (
            <Box flexDirection="column">
                <Text bold>Revert Changeset: {changesetName}</Text>
                <Box marginTop={1}>
                    <Confirm
                        message={`Are you sure you want to revert "${changesetName}"?`}
                        onConfirm={runRevert}
                        onCancel={back}
                    />
                </Box>
            </Box>
        );
    }

    if (phase === 'running') {

        return (
            <Box flexDirection="column">
                <Text bold>Reverting Changeset: {changesetName}</Text>
                <Box marginTop={1}>
                    {progress ? (
                        <ProgressBar
                            current={progress.current}
                            total={progress.total}
                            label={progress.message}
                        />
                    ) : (
                        <Spinner label="Reverting..." />
                    )}
                </Box>
            </Box>
        );
    }

    if (phase === 'done' && result) {

        const isSuccess = result.status === 'success';

        return (
            <Box flexDirection="column">
                <Text bold>Revert Changeset: {changesetName}</Text>
                <Box marginTop={1}>
                    <Alert
                        type={isSuccess ? 'success' : 'error'}
                        title={isSuccess ? 'Reverted' : 'Failed'}
                        message={
                            isSuccess
                                ? `Reverted ${result.filesExecuted} files in ${Math.round(result.durationMs)}ms`
                                : 'Revert failed'
                        }
                    />
                </Box>
                <Footer actions={[{ key: 'enter', label: 'done' }]} />
            </Box>
        );
    }

    return <Spinner label="Loading..." />;
}

export default ChangeRevertScreen;
```


## Next Changesets Screen

```typescript
// src/cli/screens/change/next.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
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
import { ChangesetManager, ExecuteResult } from '../../../core/changeset';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';

type Phase = 'input' | 'confirm' | 'running' | 'done' | 'error';

export function ChangeNextScreen() {

    const { navigate, back } = useRouter();
    const { params } = useRoute();

    const [phase, setPhase] = useState<Phase>('input');
    const [count, setCount] = useState(String(params.count ?? 1));
    const [config, setConfig] = useState<Config | null>(null);
    const [pendingCount, setPendingCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<ExecuteResult[]>([]);

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

        // Get pending count
        const [conn] = await attempt(() => createConnection(cfg.connection, cfg.name));

        if (conn) {

            const manager = new ChangesetManager(conn.db, cfg);
            const [pending] = await attempt(() => manager.getPending());
            await conn.destroy();

            setPendingCount(pending?.length ?? 0);
        }
    }

    async function runNext() {

        const n = parseInt(count, 10);

        if (isNaN(n) || n < 1) {

            setError('Please enter a valid number');
            return;
        }

        setPhase('running');

        const [conn, connErr] = await attempt(() =>
            createConnection(config!.connection, config!.name)
        );

        if (connErr) {

            setPhase('error');
            setError(`Connection failed: ${connErr.message}`);
            return;
        }

        const manager = new ChangesetManager(conn!.db, config!);
        await manager.ensureTables();

        const [res, runErr] = await attempt(() => manager.next(n));

        await conn!.destroy();

        if (runErr) {

            setPhase('error');
            setError(runErr.message);
            return;
        }

        setResults(res!);
        setPhase('done');
    }

    function handleSubmit() {

        if (config?.protected) {

            setPhase('confirm');
        }
        else {

            runNext();
        }
    }

    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Text bold>Apply Next Changesets</Text>
                <Box marginTop={1}>
                    <Alert type="error" message={error!} />
                </Box>
            </Box>
        );
    }

    if (phase === 'input') {

        if (!config) {

            return <Spinner label="Loading..." />;
        }

        if (pendingCount === 0) {

            return (
                <Box flexDirection="column">
                    <Text bold>Apply Next Changesets</Text>
                    <Box marginTop={1}>
                        <Alert type="info" message="No pending changesets to apply" />
                    </Box>
                </Box>
            );
        }

        return (
            <Box flexDirection="column">
                <Text bold>Apply Next Changesets</Text>
                <Text color="gray">{pendingCount} pending</Text>

                <Box marginTop={1}>
                    <TextInput
                        label="Number of changesets to apply"
                        value={count}
                        onChange={setCount}
                        onSubmit={handleSubmit}
                        placeholder="1"
                    />
                </Box>

                <Footer actions={[{ key: 'enter', label: 'apply' }]} />
            </Box>
        );
    }

    if (phase === 'confirm' && config?.protected) {

        return (
            <Box flexDirection="column">
                <Text bold>Apply Next {count} Changesets</Text>
                <Box marginTop={1}>
                    <ProtectedConfirm
                        configName={config.name}
                        action={`apply next ${count} changeset(s)`}
                        onConfirm={runNext}
                        onCancel={back}
                    />
                </Box>
            </Box>
        );
    }

    if (phase === 'running') {

        return (
            <Box flexDirection="column">
                <Text bold>Applying Changesets...</Text>
                <Box marginTop={1}>
                    {progress ? (
                        <ProgressBar
                            current={progress.current}
                            total={progress.total}
                            label={progress.message}
                        />
                    ) : (
                        <Spinner label="Starting..." />
                    )}
                </Box>
            </Box>
        );
    }

    if (phase === 'done') {

        const successCount = results.filter(r => r.status === 'success').length;
        const failedCount = results.filter(r => r.status === 'failed').length;

        const items = results.map(r => ({
            key: r.name,
            label: r.name,
            status: r.status as any,
            detail: `${r.filesExecuted} files, ${Math.round(r.durationMs)}ms`,
        }));

        return (
            <Box flexDirection="column">
                <Text bold>Apply Next Changesets - Complete</Text>

                <Box marginTop={1} gap={2}>
                    <Text color="green">{successCount} applied</Text>
                    {failedCount > 0 && <Text color="red">{failedCount} failed</Text>}
                </Box>

                <Box marginTop={1}>
                    <StatusList items={items} />
                </Box>

                <Footer actions={[{ key: 'enter', label: 'done' }]} />
            </Box>
        );
    }

    return <Spinner label="Loading..." />;
}

export default ChangeNextScreen;
```


## Fast-Forward Screen

```typescript
// src/cli/screens/change/ff.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import {
    Footer,
    Alert,
    Spinner,
    ProgressBar,
    StatusList,
    ProtectedConfirm,
    Confirm
} from '../../components';
import { useProgress } from '../../hooks/useProgress';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { ChangesetManager, ExecuteResult, Changeset } from '../../../core/changeset';
import { Config } from '../../../core/config/types';
import { attempt } from '@logosdx/utils';

type Phase = 'loading' | 'confirm' | 'running' | 'done' | 'error';

export function ChangeFastForwardScreen() {

    const { navigate, back } = useRouter();

    const [phase, setPhase] = useState<Phase>('loading');
    const [config, setConfig] = useState<Config | null>(null);
    const [pending, setPending] = useState<Changeset[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<ExecuteResult[]>([]);

    const progress = useProgress();

    useEffect(() => {

        loadPending();
    }, []);

    async function loadPending() {

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

        const [conn, connErr] = await attempt(() =>
            createConnection(cfg.connection, cfg.name)
        );

        if (connErr) {

            setPhase('error');
            setError(`Connection failed: ${connErr.message}`);
            return;
        }

        const manager = new ChangesetManager(conn!.db, cfg);
        const [pendingList] = await attempt(() => manager.getPending());

        await conn!.destroy();

        if (!pendingList || pendingList.length === 0) {

            setPending([]);
            setPhase('done');
            return;
        }

        setPending(pendingList);
        setPhase('confirm');
    }

    async function runFastForward() {

        setPhase('running');

        const [conn, connErr] = await attempt(() =>
            createConnection(config!.connection, config!.name)
        );

        if (connErr) {

            setPhase('error');
            setError(`Connection failed: ${connErr.message}`);
            return;
        }

        const manager = new ChangesetManager(conn!.db, config!);
        await manager.ensureTables();

        const [res, runErr] = await attempt(() => manager.fastForward());

        await conn!.destroy();

        if (runErr) {

            setPhase('error');
            setError(runErr.message);
            return;
        }

        setResults(res!);
        setPhase('done');
    }

    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Text bold>Fast-Forward</Text>
                <Box marginTop={1}>
                    <Alert type="error" message={error!} />
                </Box>
            </Box>
        );
    }

    if (phase === 'loading') {

        return <Spinner label="Loading pending changesets..." />;
    }

    if (phase === 'confirm') {

        if (config?.protected) {

            return (
                <Box flexDirection="column">
                    <Text bold>Fast-Forward: {pending.length} changesets</Text>

                    <Box marginTop={1} flexDirection="column">
                        {pending.slice(0, 5).map(cs => (
                            <Text key={cs.name} color="gray">  {'\u25cb'} {cs.name}</Text>
                        ))}
                        {pending.length > 5 && (
                            <Text color="gray">  ... and {pending.length - 5} more</Text>
                        )}
                    </Box>

                    <Box marginTop={1}>
                        <ProtectedConfirm
                            configName={config.name}
                            action={`apply ${pending.length} changeset(s)`}
                            onConfirm={runFastForward}
                            onCancel={back}
                        />
                    </Box>
                </Box>
            );
        }

        return (
            <Box flexDirection="column">
                <Text bold>Fast-Forward: {pending.length} changesets</Text>

                <Box marginTop={1} flexDirection="column">
                    {pending.slice(0, 5).map(cs => (
                        <Text key={cs.name} color="gray">  {'\u25cb'} {cs.name}</Text>
                    ))}
                    {pending.length > 5 && (
                        <Text color="gray">  ... and {pending.length - 5} more</Text>
                    )}
                </Box>

                <Box marginTop={1}>
                    <Confirm
                        message={`Apply all ${pending.length} pending changesets?`}
                        onConfirm={runFastForward}
                        onCancel={back}
                    />
                </Box>
            </Box>
        );
    }

    if (phase === 'running') {

        return (
            <Box flexDirection="column">
                <Text bold>Fast-Forward in Progress...</Text>
                <Box marginTop={1}>
                    {progress ? (
                        <ProgressBar
                            current={progress.current}
                            total={progress.total}
                            label={progress.message}
                        />
                    ) : (
                        <Spinner label="Starting..." />
                    )}
                </Box>
            </Box>
        );
    }

    if (phase === 'done') {

        if (results.length === 0 && pending.length === 0) {

            return (
                <Box flexDirection="column">
                    <Text bold>Fast-Forward</Text>
                    <Box marginTop={1}>
                        <Alert type="info" message="No pending changesets. Already up to date!" />
                    </Box>
                    <Footer actions={[{ key: 'enter', label: 'done' }]} />
                </Box>
            );
        }

        const successCount = results.filter(r => r.status === 'success').length;
        const failedCount = results.filter(r => r.status === 'failed').length;
        const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

        const items = results.map(r => ({
            key: r.name,
            label: r.name,
            status: r.status as any,
            detail: r.error ?? `${Math.round(r.durationMs)}ms`,
        }));

        return (
            <Box flexDirection="column">
                <Text bold>Fast-Forward Complete</Text>

                <Box marginTop={1} gap={2}>
                    <Text color="green">{successCount} applied</Text>
                    {failedCount > 0 && <Text color="red">{failedCount} failed</Text>}
                    <Text color="gray">({Math.round(totalDuration)}ms total)</Text>
                </Box>

                <Box marginTop={1}>
                    <StatusList items={items} />
                </Box>

                <Footer actions={[{ key: 'enter', label: 'done' }]} />
            </Box>
        );
    }

    return <Spinner label="Loading..." />;
}

export default ChangeFastForwardScreen;
```


## Edit & Remove Screens

```typescript
// src/cli/screens/change/edit.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { useRoute } from '../../router';
import { Alert } from '../../components';
import { exec } from 'child_process';

export function ChangeEditScreen() {

    const { params } = useRoute();
    const changesetName = params.name;

    // Open in default editor
    React.useEffect(() => {

        const editor = process.env.EDITOR || 'vim';
        // Would open editor - simplified for plan
    }, []);

    return (
        <Box flexDirection="column">
            <Text bold>Edit Changeset: {changesetName}</Text>
            <Text color="gray" marginTop={1}>
                Opening in editor...
            </Text>
        </Box>
    );
}

export default ChangeEditScreen;
```

```typescript
// src/cli/screens/change/rm.tsx

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter, useRoute } from '../../router';
import { Confirm, Alert, Spinner } from '../../components';
import { getStateManager } from '../../../core/state';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { attempt } from '@logosdx/utils';

export function ChangeRemoveScreen() {

    const { navigate, back } = useRouter();
    const { params } = useRoute();
    const changesetName = params.name;

    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleDelete() {

        setDeleting(true);

        const [stateManager] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (!stateManager) {

            setError('Failed to load state');
            setDeleting(false);
            return;
        }

        const config = stateManager.getActiveConfig();

        if (!config) {

            setError('No active configuration');
            setDeleting(false);
            return;
        }

        const changesetPath = resolve(config.paths.changesets, changesetName!);

        const [, rmErr] = await attempt(() =>
            rm(changesetPath, { recursive: true })
        );

        if (rmErr) {

            setError(rmErr.message);
            setDeleting(false);
            return;
        }

        navigate('change');
    }

    if (deleting) {

        return <Spinner label="Deleting changeset..." />;
    }

    if (error) {

        return <Alert type="error" message={error} />;
    }

    return (
        <Box flexDirection="column">
            <Text bold>Remove Changeset</Text>
            <Box marginTop={1}>
                <Confirm
                    message={`Delete changeset "${changesetName}"? This cannot be undone.`}
                    onConfirm={handleDelete}
                    onCancel={back}
                />
            </Box>
        </Box>
    );
}

export default ChangeRemoveScreen;
```


## Index Exports

```typescript
// src/cli/screens/change/index.tsx

export { default as list } from './list';
export { default as add } from './add';
export { default as edit } from './edit';
export { default as rm } from './rm';
export { default as run } from './run';
export { default as revert } from './revert';
export { default as next } from './next';
export { default as ff } from './ff';
```


## Screen Summary

| Screen | Route | Purpose |
|--------|-------|---------|
| List | `change` | View all changesets with status |
| Add | `change/add` | Create new changeset folder |
| Edit | `change/edit` | Open in editor |
| Remove | `change/rm` | Delete changeset |
| Run | `change/run` | Apply specific changeset |
| Revert | `change/revert` | Rollback changeset |
| Next | `change/next` | Apply next N pending |
| FF | `change/ff` | Fast-forward all pending |


## Keyboard Reference

### List Screen

| Key | Action |
|-----|--------|
| `a` | Add new changeset |
| `e` | Edit selected changeset |
| `d` | Delete selected changeset |
| `r` | Run selected (if pending) |
| `v` | Revert selected (if applied) |
| `n` | Apply next N |
| `f` | Fast-forward all |
| `↑`/`↓` | Navigate list |
