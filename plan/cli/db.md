# CLI DB Screens


## Overview

The DB section provides database lifecycle management operations:

- **create** - Create the database schema from scratch (build operation)
- **destroy** - Drop all managed objects and reset tracking tables

These are high-risk operations requiring protected confirmation for non-development environments.


## File Structure

```
src/cli/screens/
├── db/
│   ├── index.tsx            # DB section exports
│   ├── DbListScreen.tsx     # DB operations overview
│   ├── DbCreateScreen.tsx   # Create database schema
│   └── DbDestroyScreen.tsx  # Destroy database objects
```


## DB List Screen

```typescript
// src/cli/screens/db/DbListScreen.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import { Footer, Panel, SelectList, Badge, Spinner } from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { attempt } from '@logosdx/utils';

interface DbState {
    loading: boolean;
    activeConfig: string | null;
    connected: boolean;
    objectCount: number;
    error: string | null;
}

export function DbListScreen() {

    const { navigate } = useRouter();
    const [state, setState] = useState<DbState>({
        loading: true,
        activeConfig: null,
        connected: false,
        objectCount: 0,
        error: null,
    });

    useEffect(() => {

        loadState();
    }, []);

    async function loadState() {

        const [manager, managerErr] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (managerErr) {

            setState({
                loading: false,
                activeConfig: null,
                connected: false,
                objectCount: 0,
                error: managerErr.message,
            });
            return;
        }

        const active = manager!.getActiveConfig();

        if (!active) {

            setState({
                loading: false,
                activeConfig: null,
                connected: false,
                objectCount: 0,
                error: null,
            });
            return;
        }

        // Test connection and get object count
        const [conn, connErr] = await attempt(() =>
            createConnection(active.connection, active.name)
        );

        if (connErr) {

            setState({
                loading: false,
                activeConfig: active.name,
                connected: false,
                objectCount: 0,
                error: null,
            });
            return;
        }

        // Count tracked files
        const [count] = await attempt(async () => {

            const result = await conn!.db
                .selectFrom('__change_files__')
                .select(conn!.db.fn.count('path').as('count'))
                .executeTakeFirst();

            return Number(result?.count ?? 0);
        });

        await conn!.destroy();

        setState({
            loading: false,
            activeConfig: active.name,
            connected: true,
            objectCount: count ?? 0,
            error: null,
        });
    }

    useScreenInput({
        'c': () => state.activeConfig && navigate('db/create'),
        'd': () => state.activeConfig && navigate('db/destroy'),
        '1': () => state.activeConfig && navigate('db/create'),
        '2': () => state.activeConfig && navigate('db/destroy'),
    }, [navigate, state.activeConfig]);

    if (state.loading) {

        return (
            <Box flexDirection="column">
                <Spinner label="Loading database status..." />
            </Box>
        );
    }

    if (state.error) {

        return (
            <Box flexDirection="column">
                <Text color="red">Error: {state.error}</Text>
            </Box>
        );
    }

    if (!state.activeConfig) {

        return (
            <Box flexDirection="column">
                <Text color="yellow">No active configuration selected.</Text>
                <Text color="gray" marginTop={1}>
                    Press <Text bold>c</Text> to go to config and select one.
                </Text>
                <Footer actions={[{ key: 'c', label: 'config' }]} />
            </Box>
        );
    }

    const actions = [
        {
            key: 'c',
            label: 'Create Schema',
            description: 'Build database from scratch',
            variant: 'primary' as const,
        },
        {
            key: 'd',
            label: 'Destroy Schema',
            description: 'Drop all managed objects',
            variant: 'danger' as const,
        },
    ];

    return (
        <Box flexDirection="column">

            <Panel title="Database Operations">

                <Box flexDirection="column" gap={1}>

                    <Box>
                        <Text color="gray">Config: </Text>
                        <Text color="cyan" bold>{state.activeConfig}</Text>
                    </Box>

                    <Box>
                        <Text color="gray">Connection: </Text>
                        <Badge
                            label={state.connected ? 'OK' : 'ERROR'}
                            variant={state.connected ? 'success' : 'error'}
                        />
                    </Box>

                    <Box>
                        <Text color="gray">Tracked Objects: </Text>
                        <Text>{state.objectCount}</Text>
                    </Box>

                </Box>

            </Panel>

            <Box marginTop={1}>
                <Panel title="Available Actions">
                    <Box flexDirection="column">
                        {actions.map(action => (

                            <Box key={action.key}>
                                <Text color={action.variant === 'danger' ? 'red' : 'yellow'}>
                                    [{action.key}]
                                </Text>
                                <Text> {action.label}</Text>
                                <Text color="gray"> - {action.description}</Text>
                            </Box>
                        ))}
                    </Box>
                </Panel>
            </Box>

            <Box marginTop={1}>
                <Text color="gray" italic>
                    Warning: These operations modify the database schema directly.
                </Text>
            </Box>

            <Footer
                actions={[
                    { key: 'c', label: 'create' },
                    { key: 'd', label: 'destroy' },
                    { key: 'Esc', label: 'back' },
                ]}
            />

        </Box>
    );
}
```


## DB Create Screen

```typescript
// src/cli/screens/db/DbCreateScreen.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Panel,
    Checkbox,
    ProtectedConfirm,
    ProgressBar,
    Spinner,
    Alert,
} from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { Runner } from '../../../core/runner';
import { useProgress } from '../../hooks/useProgress';
import { attempt } from '@logosdx/utils';
import { observer } from '@logosdx/observer';

type Phase = 'loading' | 'options' | 'confirm' | 'running' | 'done' | 'error';

interface CreateOptions {
    force: boolean;
    dryRun: boolean;
}

interface CreateResult {
    success: boolean;
    filesExecuted: number;
    duration: number;
    errors: string[];
}

export function DbCreateScreen() {

    const { navigate, back } = useRouter();
    const [phase, setPhase] = useState<Phase>('loading');
    const [config, setConfig] = useState<any>(null);
    const [isProtected, setIsProtected] = useState(false);
    const [options, setOptions] = useState<CreateOptions>({
        force: false,
        dryRun: false,
    });
    const [result, setResult] = useState<CreateResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const { progress, status, startProgress, updateProgress, completeProgress } = useProgress();

    useEffect(() => {

        loadConfig();
    }, []);

    async function loadConfig() {

        const [manager, err] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (err) {

            setError(err.message);
            setPhase('error');
            return;
        }

        const active = manager!.getActiveConfig();

        if (!active) {

            setError('No active configuration');
            setPhase('error');
            return;
        }

        setConfig(active);
        setIsProtected(active.options?.protected ?? false);
        setPhase('options');
    }

    async function handleConfirm() {

        if (isProtected && !options.dryRun) {

            setPhase('confirm');
        }
        else {

            await runCreate();
        }
    }

    async function runCreate() {

        setPhase('running');
        startProgress('Creating database schema...');

        const startTime = Date.now();
        const errors: string[] = [];

        // Subscribe to observer events
        const unsubFile = observer.subscribe('runner:file:start', (data) => {

            updateProgress({
                current: progress.current + 1,
                message: `Executing ${data.path}...`,
            });
        });

        const unsubError = observer.subscribe('runner:file:error', (data) => {

            errors.push(`${data.path}: ${data.error}`);
        });

        const [conn, connErr] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            unsubFile();
            unsubError();
            return;
        }

        const runner = new Runner(conn!.db, config);

        const [buildResult, buildErr] = await attempt(() =>
            runner.build({
                force: options.force,
                dryRun: options.dryRun,
            })
        );

        await conn!.destroy();
        unsubFile();
        unsubError();

        if (buildErr) {

            setError(buildErr.message);
            setPhase('error');
            return;
        }

        const duration = Date.now() - startTime;

        setResult({
            success: buildResult!.success,
            filesExecuted: buildResult!.executed.length,
            duration,
            errors,
        });

        completeProgress(buildResult!.success ? 'Schema created successfully' : 'Schema creation failed');
        setPhase('done');

        observer.emit('db:create:complete', {
            config: config.name,
            success: buildResult!.success,
            filesExecuted: buildResult!.executed.length,
            duration,
        });
    }

    useScreenInput({
        'f': () => phase === 'options' && setOptions(o => ({ ...o, force: !o.force })),
        'd': () => phase === 'options' && setOptions(o => ({ ...o, dryRun: !o.dryRun })),
        'enter': () => phase === 'options' && handleConfirm(),
        'r': () => phase === 'done' && loadConfig(),
        'escape': () => (phase === 'options' || phase === 'done' || phase === 'error') && back(),
    }, [phase, options, back]);

    if (phase === 'loading') {

        return (
            <Box flexDirection="column">
                <Spinner label="Loading configuration..." />
            </Box>
        );
    }

    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Alert variant="error" title="Error">
                    {error}
                </Alert>
                <Footer actions={[{ key: 'Esc', label: 'back' }]} />
            </Box>
        );
    }

    if (phase === 'options') {

        return (
            <Box flexDirection="column">

                <Panel title="Create Database Schema">

                    <Box flexDirection="column" gap={1}>

                        <Text>
                            This will execute all SQL files in the build directory
                            to create the database schema from scratch.
                        </Text>

                        <Box marginTop={1}>
                            <Text color="gray">Config: </Text>
                            <Text color="cyan" bold>{config.name}</Text>
                            {isProtected && (
                                <Text color="red" bold> [PROTECTED]</Text>
                            )}
                        </Box>

                        <Box marginTop={1} flexDirection="column">

                            <Text bold>Options:</Text>

                            <Box marginTop={1}>
                                <Checkbox
                                    label="Force rebuild (ignore checksums)"
                                    checked={options.force}
                                    onChange={(v) => setOptions(o => ({ ...o, force: v }))}
                                />
                                <Text color="gray"> [f]</Text>
                            </Box>

                            <Box>
                                <Checkbox
                                    label="Dry run (preview only)"
                                    checked={options.dryRun}
                                    onChange={(v) => setOptions(o => ({ ...o, dryRun: v }))}
                                />
                                <Text color="gray"> [d]</Text>
                            </Box>

                        </Box>

                    </Box>

                </Panel>

                <Footer
                    actions={[
                        { key: 'Enter', label: 'continue' },
                        { key: 'f', label: 'force' },
                        { key: 'd', label: 'dry run' },
                        { key: 'Esc', label: 'cancel' },
                    ]}
                />

            </Box>
        );
    }

    if (phase === 'confirm') {

        return (
            <ProtectedConfirm
                title="Confirm Schema Creation"
                message={`This will modify the database schema for "${config.name}".`}
                configName={config.name}
                onConfirm={runCreate}
                onCancel={() => setPhase('options')}
            />
        );
    }

    if (phase === 'running') {

        return (
            <Box flexDirection="column">

                <Panel title="Creating Schema">

                    <Box flexDirection="column" gap={1}>
                        <Spinner label={status} />
                        <ProgressBar
                            value={progress.current}
                            total={progress.total || 100}
                            width={50}
                        />
                        <Text color="gray">{progress.message}</Text>
                    </Box>

                </Panel>

            </Box>
        );
    }

    if (phase === 'done' && result) {

        return (
            <Box flexDirection="column">

                <Alert
                    variant={result.success ? 'success' : 'error'}
                    title={result.success ? 'Schema Created' : 'Creation Failed'}
                >
                    {result.success
                        ? `Successfully executed ${result.filesExecuted} files in ${result.duration}ms`
                        : `Failed with ${result.errors.length} errors`
                    }
                </Alert>

                {result.errors.length > 0 && (
                    <Panel title="Errors" marginTop={1}>
                        <Box flexDirection="column">
                            {result.errors.slice(0, 10).map((err, i) => (

                                <Text key={i} color="red">• {err}</Text>
                            ))}
                            {result.errors.length > 10 && (
                                <Text color="gray">... and {result.errors.length - 10} more</Text>
                            )}
                        </Box>
                    </Panel>
                )}

                <Footer
                    actions={[
                        { key: 'r', label: 'retry' },
                        { key: 'Esc', label: 'back' },
                    ]}
                />

            </Box>
        );
    }

    return null;
}
```


## DB Destroy Screen

```typescript
// src/cli/screens/db/DbDestroyScreen.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Panel,
    Checkbox,
    ProtectedConfirm,
    ProgressBar,
    Spinner,
    Alert,
    StatusList,
} from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { useProgress } from '../../hooks/useProgress';
import { attempt } from '@logosdx/utils';
import { observer } from '@logosdx/observer';

type Phase = 'loading' | 'preview' | 'confirm' | 'running' | 'done' | 'error';

interface DestroyOptions {
    dropTables: boolean;
    resetTracking: boolean;
}

interface TrackedObject {
    path: string;
    type: 'table' | 'view' | 'function' | 'procedure' | 'trigger' | 'index';
    checksum: string;
}

interface DestroyResult {
    success: boolean;
    objectsDropped: number;
    trackingReset: boolean;
    duration: number;
    errors: string[];
}

export function DbDestroyScreen() {

    const { back } = useRouter();
    const [phase, setPhase] = useState<Phase>('loading');
    const [config, setConfig] = useState<any>(null);
    const [objects, setObjects] = useState<TrackedObject[]>([]);
    const [options, setOptions] = useState<DestroyOptions>({
        dropTables: true,
        resetTracking: true,
    });
    const [result, setResult] = useState<DestroyResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const { progress, status, startProgress, updateProgress, completeProgress } = useProgress();

    useEffect(() => {

        loadPreview();
    }, []);

    async function loadPreview() {

        const [manager, managerErr] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (managerErr) {

            setError(managerErr.message);
            setPhase('error');
            return;
        }

        const active = manager!.getActiveConfig();

        if (!active) {

            setError('No active configuration');
            setPhase('error');
            return;
        }

        setConfig(active);

        // Load tracked objects
        const [conn, connErr] = await attempt(() =>
            createConnection(active.connection, active.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            return;
        }

        const [tracked] = await attempt(async () => {

            const rows = await conn!.db
                .selectFrom('__change_files__')
                .select(['path', 'checksum'])
                .execute();

            return rows.map(row => ({
                path: row.path,
                type: inferObjectType(row.path),
                checksum: row.checksum,
            }));
        });

        await conn!.destroy();

        setObjects(tracked ?? []);
        setPhase('preview');
    }

    function inferObjectType(path: string): TrackedObject['type'] {

        const lower = path.toLowerCase();

        if (lower.includes('view')) return 'view';
        if (lower.includes('function') || lower.includes('func')) return 'function';
        if (lower.includes('procedure') || lower.includes('proc')) return 'procedure';
        if (lower.includes('trigger')) return 'trigger';
        if (lower.includes('index')) return 'index';

        return 'table';
    }

    async function handleConfirm() {

        // Destroy is ALWAYS a protected operation
        setPhase('confirm');
    }

    async function runDestroy() {

        setPhase('running');
        startProgress('Destroying database objects...');

        const startTime = Date.now();
        const errors: string[] = [];

        const [conn, connErr] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            return;
        }

        let objectsDropped = 0;

        // Drop objects in reverse order (dependencies)
        if (options.dropTables) {

            const reversedObjects = [...objects].reverse();

            for (let i = 0; i < reversedObjects.length; i++) {

                const obj = reversedObjects[i];

                updateProgress({
                    current: i + 1,
                    total: reversedObjects.length,
                    message: `Dropping ${obj.path}...`,
                });

                const [, dropErr] = await attempt(async () => {

                    // Extract object name from path
                    const objectName = extractObjectName(obj.path);
                    const dropSql = generateDropStatement(obj.type, objectName, config.connection.dialect);

                    await conn!.db.executeQuery(
                        conn!.db.raw(dropSql).compile(conn!.db)
                    );
                });

                if (dropErr) {

                    errors.push(`${obj.path}: ${dropErr.message}`);
                }
                else {

                    objectsDropped++;
                }

                observer.emit('db:destroy:object', {
                    config: config.name,
                    path: obj.path,
                    success: !dropErr,
                    error: dropErr?.message,
                });
            }
        }

        // Reset tracking tables
        let trackingReset = false;

        if (options.resetTracking) {

            updateProgress({
                message: 'Resetting tracking tables...',
            });

            const [, resetErr] = await attempt(async () => {

                await conn!.db
                    .deleteFrom('__change_files__')
                    .execute();

                await conn!.db
                    .deleteFrom('__change_version__')
                    .execute();
            });

            if (resetErr) {

                errors.push(`Tracking reset: ${resetErr.message}`);
            }
            else {

                trackingReset = true;
            }
        }

        await conn!.destroy();

        const duration = Date.now() - startTime;
        const success = errors.length === 0;

        setResult({
            success,
            objectsDropped,
            trackingReset,
            duration,
            errors,
        });

        completeProgress(success ? 'Database destroyed successfully' : 'Destroy completed with errors');
        setPhase('done');

        observer.emit('db:destroy:complete', {
            config: config.name,
            success,
            objectsDropped,
            trackingReset,
            duration,
        });
    }

    function extractObjectName(path: string): string {

        // Extract name from path like "tables/users.sql" -> "users"
        const filename = path.split('/').pop() ?? path;

        return filename.replace(/\.sql(\.eta)?$/i, '');
    }

    function generateDropStatement(
        type: TrackedObject['type'],
        name: string,
        dialect: string
    ): string {

        const ifExists = dialect === 'mysql' ? 'IF EXISTS' : 'IF EXISTS';

        switch (type) {

            case 'view':
                return `DROP VIEW ${ifExists} ${name}`;

            case 'function':
                return `DROP FUNCTION ${ifExists} ${name}`;

            case 'procedure':
                return `DROP PROCEDURE ${ifExists} ${name}`;

            case 'trigger':
                return `DROP TRIGGER ${ifExists} ${name}`;

            case 'index':
                return `DROP INDEX ${ifExists} ${name}`;

            default:
                return `DROP TABLE ${ifExists} ${name} CASCADE`;
        }
    }

    useScreenInput({
        't': () => phase === 'preview' && setOptions(o => ({ ...o, dropTables: !o.dropTables })),
        'r': () => phase === 'preview' && setOptions(o => ({ ...o, resetTracking: !o.resetTracking })),
        'enter': () => phase === 'preview' && handleConfirm(),
        'escape': () => (phase === 'preview' || phase === 'done' || phase === 'error') && back(),
    }, [phase, options, back]);

    if (phase === 'loading') {

        return (
            <Box flexDirection="column">
                <Spinner label="Loading database objects..." />
            </Box>
        );
    }

    if (phase === 'error') {

        return (
            <Box flexDirection="column">
                <Alert variant="error" title="Error">
                    {error}
                </Alert>
                <Footer actions={[{ key: 'Esc', label: 'back' }]} />
            </Box>
        );
    }

    if (phase === 'preview') {

        const groupedObjects = objects.reduce((acc, obj) => {

            acc[obj.type] = (acc[obj.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return (
            <Box flexDirection="column">

                <Alert variant="warning" title="Danger Zone">
                    This will permanently destroy database objects. This action cannot be undone.
                </Alert>

                <Panel title="Objects to Destroy" marginTop={1}>

                    {objects.length === 0 ? (
                        <Text color="gray">No tracked objects found</Text>
                    ) : (
                        <Box flexDirection="column">
                            {Object.entries(groupedObjects).map(([type, count]) => (

                                <Box key={type}>
                                    <Text color="red">• {count} {type}{count > 1 ? 's' : ''}</Text>
                                </Box>
                            ))}
                            <Box marginTop={1}>
                                <Text color="gray">Total: {objects.length} objects</Text>
                            </Box>
                        </Box>
                    )}

                </Panel>

                <Panel title="Options" marginTop={1}>

                    <Box flexDirection="column">

                        <Box>
                            <Checkbox
                                label="Drop database objects"
                                checked={options.dropTables}
                                onChange={(v) => setOptions(o => ({ ...o, dropTables: v }))}
                            />
                            <Text color="gray"> [t]</Text>
                        </Box>

                        <Box>
                            <Checkbox
                                label="Reset tracking tables"
                                checked={options.resetTracking}
                                onChange={(v) => setOptions(o => ({ ...o, resetTracking: v }))}
                            />
                            <Text color="gray"> [r]</Text>
                        </Box>

                    </Box>

                </Panel>

                <Footer
                    actions={[
                        { key: 'Enter', label: 'destroy' },
                        { key: 't', label: 'toggle drop' },
                        { key: 'r', label: 'toggle reset' },
                        { key: 'Esc', label: 'cancel' },
                    ]}
                />

            </Box>
        );
    }

    if (phase === 'confirm') {

        return (
            <ProtectedConfirm
                title="Confirm Database Destruction"
                message={
                    `This will PERMANENTLY destroy ${objects.length} database objects ` +
                    `in "${config.name}". This action cannot be undone!`
                }
                configName={config.name}
                onConfirm={runDestroy}
                onCancel={() => setPhase('preview')}
            />
        );
    }

    if (phase === 'running') {

        return (
            <Box flexDirection="column">

                <Panel title="Destroying Database">

                    <Box flexDirection="column" gap={1}>
                        <Spinner label={status} />
                        <ProgressBar
                            value={progress.current}
                            total={progress.total || objects.length}
                            width={50}
                        />
                        <Text color="gray">{progress.message}</Text>
                    </Box>

                </Panel>

            </Box>
        );
    }

    if (phase === 'done' && result) {

        return (
            <Box flexDirection="column">

                <Alert
                    variant={result.success ? 'success' : 'warning'}
                    title={result.success ? 'Database Destroyed' : 'Completed with Errors'}
                >
                    {result.success
                        ? `Dropped ${result.objectsDropped} objects in ${result.duration}ms`
                        : `Dropped ${result.objectsDropped} objects with ${result.errors.length} errors`
                    }
                </Alert>

                <Panel title="Summary" marginTop={1}>
                    <Box flexDirection="column">
                        <Text>Objects dropped: {result.objectsDropped}</Text>
                        <Text>Tracking reset: {result.trackingReset ? 'Yes' : 'No'}</Text>
                        <Text>Duration: {result.duration}ms</Text>
                    </Box>
                </Panel>

                {result.errors.length > 0 && (
                    <Panel title="Errors" marginTop={1}>
                        <Box flexDirection="column">
                            {result.errors.slice(0, 10).map((err, i) => (

                                <Text key={i} color="red">• {err}</Text>
                            ))}
                            {result.errors.length > 10 && (
                                <Text color="gray">... and {result.errors.length - 10} more</Text>
                            )}
                        </Box>
                    </Panel>
                )}

                <Footer actions={[{ key: 'Esc', label: 'back' }]} />

            </Box>
        );
    }

    return null;
}
```


## Index Export

```typescript
// src/cli/screens/db/index.tsx

export { DbListScreen as default } from './DbListScreen';
export { DbCreateScreen } from './DbCreateScreen';
export { DbDestroyScreen } from './DbDestroyScreen';
```


## Screen Layouts


### DB List Screen

```
┌─────────────────────────────────────────────────────────────────┐
│  Config   Change   Run   [DB]   Lock                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Database Operations                                      │   │
│  │                                                          │   │
│  │ Config: dev                                              │   │
│  │ Connection: [OK]                                         │   │
│  │ Tracked Objects: 15                                      │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Available Actions                                        │   │
│  │                                                          │   │
│  │ [c] Create Schema - Build database from scratch          │   │
│  │ [d] Destroy Schema - Drop all managed objects            │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Warning: These operations modify the database schema directly. │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [c]create  [d]destroy  [Esc]back                               │
└─────────────────────────────────────────────────────────────────┘
```


### DB Create Screen (Options Phase)

```
┌─────────────────────────────────────────────────────────────────┐
│  Config   Change   Run   [DB]   Lock                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Create Database Schema                                   │   │
│  │                                                          │   │
│  │ This will execute all SQL files in the build directory   │   │
│  │ to create the database schema from scratch.              │   │
│  │                                                          │   │
│  │ Config: dev [PROTECTED]                                  │   │
│  │                                                          │   │
│  │ Options:                                                 │   │
│  │ [✓] Force rebuild (ignore checksums) [f]                 │   │
│  │ [ ] Dry run (preview only) [d]                           │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Enter]continue  [f]force  [d]dry run  [Esc]cancel             │
└─────────────────────────────────────────────────────────────────┘
```


### DB Destroy Screen (Preview Phase)

```
┌─────────────────────────────────────────────────────────────────┐
│  Config   Change   Run   [DB]   Lock                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⚠ Danger Zone                                                  │
│  This will permanently destroy database objects.                │
│  This action cannot be undone.                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Objects to Destroy                                       │   │
│  │                                                          │   │
│  │ • 10 tables                                              │   │
│  │ • 3 views                                                │   │
│  │ • 2 functions                                            │   │
│  │                                                          │   │
│  │ Total: 15 objects                                        │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Options                                                  │   │
│  │                                                          │   │
│  │ [✓] Drop database objects [t]                            │   │
│  │ [✓] Reset tracking tables [r]                            │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Enter]destroy  [t]toggle drop  [r]toggle reset  [Esc]cancel   │
└─────────────────────────────────────────────────────────────────┘
```


## Keyboard Shortcuts


### DB List

| Key | Action |
|-----|--------|
| `c` | Go to create screen |
| `d` | Go to destroy screen |
| `1` | Go to create screen |
| `2` | Go to destroy screen |
| `Esc` | Go back |


### DB Create

| Key | Action |
|-----|--------|
| `f` | Toggle force option |
| `d` | Toggle dry run option |
| `Enter` | Continue/Confirm |
| `r` | Retry (done phase) |
| `Esc` | Cancel/Back |


### DB Destroy

| Key | Action |
|-----|--------|
| `t` | Toggle drop tables option |
| `r` | Toggle reset tracking option |
| `Enter` | Continue to confirm |
| `Esc` | Cancel/Back |


## Observer Events

```typescript
// DB create events
observer.emit('db:create:start', { config: string });
observer.emit('db:create:complete', {
    config: string;
    success: boolean;
    filesExecuted: number;
    duration: number;
});

// DB destroy events
observer.emit('db:destroy:start', { config: string });
observer.emit('db:destroy:object', {
    config: string;
    path: string;
    success: boolean;
    error?: string;
});
observer.emit('db:destroy:complete', {
    config: string;
    success: boolean;
    objectsDropped: number;
    trackingReset: boolean;
    duration: number;
});
```


## Headless Mode Support

```typescript
// CLI commands
noorm db:create [config] [--force] [--dry-run]
noorm db:destroy [config] [--drop-tables] [--reset-tracking] [--yes]

// Examples
noorm db:create dev --force
noorm db:destroy staging --yes
noorm db:create prod --dry-run
```


## Testing

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { DbCreateScreen } from './DbCreateScreen';
import { DbDestroyScreen } from './DbDestroyScreen';
import { RouterProvider } from '../../router';

describe('DbCreateScreen', () => {

    it('should show options when config loaded', async () => {

        const { lastFrame } = render(
            <RouterProvider>
                <DbCreateScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('Create Database Schema');
        expect(lastFrame()).toContain('Force rebuild');
    });

    it('should require protected confirm for protected configs', async () => {

        // Mock protected config
        const { stdin, lastFrame } = render(
            <RouterProvider>
                <DbCreateScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        stdin.write('\r'); // Enter

        await new Promise(r => setTimeout(r, 50));

        expect(lastFrame()).toContain('yes-');
    });
});

describe('DbDestroyScreen', () => {

    it('should show preview of objects', async () => {

        const { lastFrame } = render(
            <RouterProvider>
                <DbDestroyScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('Objects to Destroy');
    });

    it('should always require protected confirm', async () => {

        const { stdin, lastFrame } = render(
            <RouterProvider>
                <DbDestroyScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        stdin.write('\r'); // Enter

        await new Promise(r => setTimeout(r, 50));

        expect(lastFrame()).toContain('yes-');
    });
});
```
