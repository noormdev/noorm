# CLI Lock Screens


## Overview

The Lock section provides database lock management for coordinating schema changes across teams:

- **status** - View current lock status and holder information
- **acquire** - Acquire an advisory lock for exclusive schema access
- **release** - Release a held lock
- **force-release** - Force release a stale or orphaned lock (dangerous)

Locks prevent concurrent schema modifications that could cause conflicts or corruption.


## File Structure

```
src/cli/screens/
├── lock/
│   ├── index.tsx              # Lock section exports
│   ├── LockListScreen.tsx     # Lock status overview
│   ├── LockAcquireScreen.tsx  # Acquire lock
│   ├── LockReleaseScreen.tsx  # Release lock
│   └── LockForceScreen.tsx    # Force release lock
```


## Lock List Screen

```typescript
// src/cli/screens/lock/LockListScreen.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import { Footer, Panel, Badge, Spinner, Alert } from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { LockManager, LockStatus } from '../../../core/lock';
import { attempt } from '@logosdx/utils';

interface LockState {
    loading: boolean;
    activeConfig: string | null;
    lockStatus: LockStatus | null;
    isOwnLock: boolean;
    error: string | null;
}

export function LockListScreen() {

    const { navigate } = useRouter();
    const [state, setState] = useState<LockState>({
        loading: true,
        activeConfig: null,
        lockStatus: null,
        isOwnLock: false,
        error: null,
    });

    useEffect(() => {

        loadStatus();
    }, []);

    async function loadStatus() {

        const [manager, managerErr] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (managerErr) {

            setState({
                loading: false,
                activeConfig: null,
                lockStatus: null,
                isOwnLock: false,
                error: managerErr.message,
            });
            return;
        }

        const active = manager!.getActiveConfig();

        if (!active) {

            setState({
                loading: false,
                activeConfig: null,
                lockStatus: null,
                isOwnLock: false,
                error: null,
            });
            return;
        }

        const [conn, connErr] = await attempt(() =>
            createConnection(active.connection, active.name)
        );

        if (connErr) {

            setState({
                loading: false,
                activeConfig: active.name,
                lockStatus: null,
                isOwnLock: false,
                error: connErr.message,
            });
            return;
        }

        const lockMgr = new LockManager(conn!.db, active.connection.dialect, active.name);
        const [status] = await attempt(() => lockMgr.getStatus());

        await conn!.destroy();

        const currentIdentity = `${process.env.USER || 'unknown'}@${require('os').hostname()}`;

        setState({
            loading: false,
            activeConfig: active.name,
            lockStatus: status ?? null,
            isOwnLock: status?.lockedBy === currentIdentity,
            error: null,
        });
    }

    useScreenInput({
        'a': () => state.activeConfig && !state.lockStatus && navigate('lock/acquire'),
        'r': () => state.activeConfig && state.lockStatus && navigate('lock/release'),
        'f': () => state.activeConfig && state.lockStatus && !state.isOwnLock && navigate('lock/force'),
        'R': () => loadStatus(),
    }, [navigate, state]);

    if (state.loading) {

        return (
            <Box flexDirection="column">
                <Spinner label="Loading lock status..." />
            </Box>
        );
    }

    if (state.error) {

        return (
            <Box flexDirection="column">
                <Alert variant="error" title="Connection Error">
                    {state.error}
                </Alert>
                <Footer actions={[{ key: 'R', label: 'retry' }, { key: 'Esc', label: 'back' }]} />
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

    return (
        <Box flexDirection="column">

            <Panel title="Lock Status">

                <Box flexDirection="column" gap={1}>

                    <Box>
                        <Text color="gray">Config: </Text>
                        <Text color="cyan" bold>{state.activeConfig}</Text>
                    </Box>

                    <Box>
                        <Text color="gray">Status: </Text>
                        {state.lockStatus ? (
                            <Badge label="LOCKED" variant="error" />
                        ) : (
                            <Badge label="FREE" variant="success" />
                        )}
                    </Box>

                    {state.lockStatus && (
                        <>
                            <Box>
                                <Text color="gray">Held by: </Text>
                                <Text bold>{state.lockStatus.lockedBy}</Text>
                                {state.isOwnLock && (
                                    <Text color="green"> (you)</Text>
                                )}
                            </Box>

                            <Box>
                                <Text color="gray">Since: </Text>
                                <Text>{formatDate(state.lockStatus.lockedAt)}</Text>
                                <Text color="gray"> ({formatDuration(state.lockStatus.lockedAt)})</Text>
                            </Box>

                            {state.lockStatus.reason && (
                                <Box>
                                    <Text color="gray">Reason: </Text>
                                    <Text>{state.lockStatus.reason}</Text>
                                </Box>
                            )}
                        </>
                    )}

                </Box>

            </Panel>

            <Box marginTop={1}>
                <Panel title="Actions">
                    <Box flexDirection="column">

                        {!state.lockStatus && (
                            <Box>
                                <Text color="yellow">[a] </Text>
                                <Text>Acquire Lock</Text>
                                <Text color="gray"> - Get exclusive access</Text>
                            </Box>
                        )}

                        {state.lockStatus && state.isOwnLock && (
                            <Box>
                                <Text color="yellow">[r] </Text>
                                <Text>Release Lock</Text>
                                <Text color="gray"> - Give up exclusive access</Text>
                            </Box>
                        )}

                        {state.lockStatus && !state.isOwnLock && (
                            <Box>
                                <Text color="red">[f] </Text>
                                <Text color="red">Force Release</Text>
                                <Text color="gray"> - Break another user's lock (dangerous)</Text>
                            </Box>
                        )}

                        <Box>
                            <Text color="yellow">[R] </Text>
                            <Text>Refresh</Text>
                            <Text color="gray"> - Reload lock status</Text>
                        </Box>

                    </Box>
                </Panel>
            </Box>

            {state.lockStatus && !state.isOwnLock && (
                <Box marginTop={1}>
                    <Alert variant="warning" title="Lock Held by Another User">
                        You cannot modify the schema while another user holds the lock.
                        Contact {state.lockStatus.lockedBy} to coordinate.
                    </Alert>
                </Box>
            )}

            <Footer
                actions={[
                    ...(!state.lockStatus ? [{ key: 'a', label: 'acquire' }] : []),
                    ...(state.lockStatus && state.isOwnLock ? [{ key: 'r', label: 'release' }] : []),
                    ...(state.lockStatus && !state.isOwnLock ? [{ key: 'f', label: 'force' }] : []),
                    { key: 'R', label: 'refresh' },
                    { key: 'Esc', label: 'back' },
                ]}
            />

        </Box>
    );
}

function formatDate(date: Date): string {

    return date.toLocaleString();
}

function formatDuration(since: Date): string {

    const now = new Date();
    const diffMs = now.getTime() - since.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}
```


## Lock Acquire Screen

```typescript
// src/cli/screens/lock/LockAcquireScreen.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Panel,
    TextInput,
    Spinner,
    Alert,
    Confirm,
} from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { LockManager } from '../../../core/lock';
import { attempt } from '@logosdx/utils';
import { observer } from '@logosdx/observer';

type Phase = 'loading' | 'input' | 'confirm' | 'acquiring' | 'done' | 'error';

export function LockAcquireScreen() {

    const { back } = useRouter();
    const [phase, setPhase] = useState<Phase>('loading');
    const [config, setConfig] = useState<any>(null);
    const [reason, setReason] = useState('');
    const [error, setError] = useState<string | null>(null);

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
        setPhase('input');
    }

    async function handleAcquire() {

        setPhase('acquiring');

        const [conn, connErr] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            return;
        }

        const lockMgr = new LockManager(conn!.db, config.connection.dialect, config.name);

        const [acquired, acquireErr] = await attempt(() =>
            lockMgr.acquire(reason || undefined)
        );

        await conn!.destroy();

        if (acquireErr) {

            setError(acquireErr.message);
            setPhase('error');
            return;
        }

        if (!acquired) {

            setError('Failed to acquire lock - it may be held by another user');
            setPhase('error');
            return;
        }

        observer.emit('lock:acquired', {
            config: config.name,
            reason,
        });

        setPhase('done');
    }

    useScreenInput({
        'enter': () => phase === 'input' && setPhase('confirm'),
        'escape': () => (phase === 'input' || phase === 'done' || phase === 'error') && back(),
    }, [phase, back]);

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

    if (phase === 'input') {

        return (
            <Box flexDirection="column">

                <Panel title="Acquire Lock">

                    <Box flexDirection="column" gap={1}>

                        <Text>
                            Acquiring a lock gives you exclusive access to modify the schema.
                            Other users will be blocked from making changes until you release it.
                        </Text>

                        <Box marginTop={1}>
                            <Text color="gray">Config: </Text>
                            <Text color="cyan" bold>{config.name}</Text>
                        </Box>

                        <Box marginTop={1} flexDirection="column">
                            <Text bold>Reason (optional):</Text>
                            <Box marginTop={1}>
                                <TextInput
                                    value={reason}
                                    onChange={setReason}
                                    placeholder="e.g., Adding user roles table"
                                />
                            </Box>
                            <Text color="gray" marginTop={1}>
                                Providing a reason helps other team members understand
                                why the database is locked.
                            </Text>
                        </Box>

                    </Box>

                </Panel>

                <Footer
                    actions={[
                        { key: 'Enter', label: 'acquire' },
                        { key: 'Esc', label: 'cancel' },
                    ]}
                />

            </Box>
        );
    }

    if (phase === 'confirm') {

        return (
            <Confirm
                title="Confirm Lock Acquisition"
                message={`Acquire exclusive lock on "${config.name}"?${reason ? `\n\nReason: ${reason}` : ''}`}
                onConfirm={handleAcquire}
                onCancel={() => setPhase('input')}
            />
        );
    }

    if (phase === 'acquiring') {

        return (
            <Box flexDirection="column">
                <Spinner label="Acquiring lock..." />
            </Box>
        );
    }

    if (phase === 'done') {

        return (
            <Box flexDirection="column">

                <Alert variant="success" title="Lock Acquired">
                    You now have exclusive access to modify the schema for "{config.name}".
                </Alert>

                <Box marginTop={1}>
                    <Text color="gray">
                        Remember to release the lock when you're done to allow others to make changes.
                    </Text>
                </Box>

                <Footer actions={[{ key: 'Esc', label: 'back' }]} />

            </Box>
        );
    }

    return null;
}
```


## Lock Release Screen

```typescript
// src/cli/screens/lock/LockReleaseScreen.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Panel,
    Spinner,
    Alert,
    Confirm,
} from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { LockManager, LockStatus } from '../../../core/lock';
import { attempt } from '@logosdx/utils';
import { observer } from '@logosdx/observer';

type Phase = 'loading' | 'confirm' | 'releasing' | 'done' | 'error';

export function LockReleaseScreen() {

    const { back } = useRouter();
    const [phase, setPhase] = useState<Phase>('loading');
    const [config, setConfig] = useState<any>(null);
    const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        loadStatus();
    }, []);

    async function loadStatus() {

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

        const [conn, connErr] = await attempt(() =>
            createConnection(active.connection, active.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            return;
        }

        const lockMgr = new LockManager(conn!.db, active.connection.dialect, active.name);
        const [status] = await attempt(() => lockMgr.getStatus());

        await conn!.destroy();

        if (!status) {

            setError('No lock is currently held');
            setPhase('error');
            return;
        }

        const currentIdentity = `${process.env.USER || 'unknown'}@${require('os').hostname()}`;

        if (status.lockedBy !== currentIdentity) {

            setError(`Lock is held by ${status.lockedBy}, not you. Use force release if needed.`);
            setPhase('error');
            return;
        }

        setLockStatus(status);
        setPhase('confirm');
    }

    async function handleRelease() {

        setPhase('releasing');

        const [conn, connErr] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            return;
        }

        const lockMgr = new LockManager(conn!.db, config.connection.dialect, config.name);

        const [released, releaseErr] = await attempt(() => lockMgr.release());

        await conn!.destroy();

        if (releaseErr) {

            setError(releaseErr.message);
            setPhase('error');
            return;
        }

        if (!released) {

            setError('Failed to release lock');
            setPhase('error');
            return;
        }

        observer.emit('lock:released', {
            config: config.name,
        });

        setPhase('done');
    }

    useScreenInput({
        'escape': () => (phase === 'confirm' || phase === 'done' || phase === 'error') && back(),
    }, [phase, back]);

    if (phase === 'loading') {

        return (
            <Box flexDirection="column">
                <Spinner label="Loading lock status..." />
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

    if (phase === 'confirm') {

        return (
            <Box flexDirection="column">

                <Panel title="Release Lock">

                    <Box flexDirection="column" gap={1}>

                        <Text>
                            You are about to release your lock on "{config.name}".
                        </Text>

                        {lockStatus && (
                            <Box marginTop={1} flexDirection="column">
                                <Text color="gray">Held since: {lockStatus.lockedAt.toLocaleString()}</Text>
                                {lockStatus.reason && (
                                    <Text color="gray">Reason: {lockStatus.reason}</Text>
                                )}
                            </Box>
                        )}

                        <Box marginTop={1}>
                            <Text color="yellow">
                                After releasing, other users will be able to modify the schema.
                            </Text>
                        </Box>

                    </Box>

                </Panel>

                <Confirm
                    title="Release Lock?"
                    message="Are you sure you want to release the lock?"
                    onConfirm={handleRelease}
                    onCancel={back}
                />

            </Box>
        );
    }

    if (phase === 'releasing') {

        return (
            <Box flexDirection="column">
                <Spinner label="Releasing lock..." />
            </Box>
        );
    }

    if (phase === 'done') {

        return (
            <Box flexDirection="column">

                <Alert variant="success" title="Lock Released">
                    The lock on "{config.name}" has been released.
                    Other users can now modify the schema.
                </Alert>

                <Footer actions={[{ key: 'Esc', label: 'back' }]} />

            </Box>
        );
    }

    return null;
}
```


## Lock Force Release Screen

```typescript
// src/cli/screens/lock/LockForceScreen.tsx

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import {
    Footer,
    Panel,
    Spinner,
    Alert,
    ProtectedConfirm,
} from '../../components';
import { getStateManager } from '../../../core/state';
import { createConnection } from '../../../core/connection';
import { LockManager, LockStatus } from '../../../core/lock';
import { attempt } from '@logosdx/utils';
import { observer } from '@logosdx/observer';

type Phase = 'loading' | 'preview' | 'confirm' | 'releasing' | 'done' | 'error';

export function LockForceScreen() {

    const { back } = useRouter();
    const [phase, setPhase] = useState<Phase>('loading');
    const [config, setConfig] = useState<any>(null);
    const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        loadStatus();
    }, []);

    async function loadStatus() {

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

        const [conn, connErr] = await attempt(() =>
            createConnection(active.connection, active.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            return;
        }

        const lockMgr = new LockManager(conn!.db, active.connection.dialect, active.name);
        const [status] = await attempt(() => lockMgr.getStatus());

        await conn!.destroy();

        if (!status) {

            setError('No lock is currently held');
            setPhase('error');
            return;
        }

        setLockStatus(status);
        setPhase('preview');
    }

    async function handleForceRelease() {

        setPhase('releasing');

        const [conn, connErr] = await attempt(() =>
            createConnection(config.connection, config.name)
        );

        if (connErr) {

            setError(connErr.message);
            setPhase('error');
            return;
        }

        const lockMgr = new LockManager(conn!.db, config.connection.dialect, config.name);

        const [, releaseErr] = await attempt(() => lockMgr.forceRelease());

        await conn!.destroy();

        if (releaseErr) {

            setError(releaseErr.message);
            setPhase('error');
            return;
        }

        observer.emit('lock:force-released', {
            config: config.name,
            previousHolder: lockStatus?.lockedBy,
        });

        setPhase('done');
    }

    useScreenInput({
        'enter': () => phase === 'preview' && setPhase('confirm'),
        'escape': () => (phase === 'preview' || phase === 'done' || phase === 'error') && back(),
    }, [phase, back]);

    if (phase === 'loading') {

        return (
            <Box flexDirection="column">
                <Spinner label="Loading lock status..." />
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

        const lockAge = lockStatus
            ? Math.floor((Date.now() - lockStatus.lockedAt.getTime()) / 3600000)
            : 0;

        return (
            <Box flexDirection="column">

                <Alert variant="error" title="Danger: Force Release Lock">
                    This will forcibly break another user's lock. Only do this if:
                    {'\n'}• The lock holder is unavailable
                    {'\n'}• The lock appears to be stale/orphaned
                    {'\n'}• You have coordinated with the lock holder
                </Alert>

                <Panel title="Current Lock" marginTop={1}>

                    <Box flexDirection="column" gap={1}>

                        <Box>
                            <Text color="gray">Held by: </Text>
                            <Text bold color="red">{lockStatus?.lockedBy}</Text>
                        </Box>

                        <Box>
                            <Text color="gray">Since: </Text>
                            <Text>{lockStatus?.lockedAt.toLocaleString()}</Text>
                            <Text color={lockAge > 24 ? 'yellow' : 'gray'}>
                                {' '}({lockAge} hours ago)
                            </Text>
                        </Box>

                        {lockStatus?.reason && (
                            <Box>
                                <Text color="gray">Reason: </Text>
                                <Text>{lockStatus.reason}</Text>
                            </Box>
                        )}

                        {lockAge > 24 && (
                            <Box marginTop={1}>
                                <Text color="yellow">
                                    ⚠ This lock is over 24 hours old and may be stale.
                                </Text>
                            </Box>
                        )}

                    </Box>

                </Panel>

                <Box marginTop={1}>
                    <Text color="gray">
                        Warning: Force releasing may cause conflicts if the lock holder
                        is actively working on schema changes.
                    </Text>
                </Box>

                <Footer
                    actions={[
                        { key: 'Enter', label: 'force release' },
                        { key: 'Esc', label: 'cancel' },
                    ]}
                />

            </Box>
        );
    }

    if (phase === 'confirm') {

        return (
            <ProtectedConfirm
                title="Confirm Force Release"
                message={
                    `This will forcibly release the lock held by ${lockStatus?.lockedBy}. ` +
                    `This action may cause schema conflicts!`
                }
                configName={config.name}
                onConfirm={handleForceRelease}
                onCancel={() => setPhase('preview')}
            />
        );
    }

    if (phase === 'releasing') {

        return (
            <Box flexDirection="column">
                <Spinner label="Force releasing lock..." />
            </Box>
        );
    }

    if (phase === 'done') {

        return (
            <Box flexDirection="column">

                <Alert variant="warning" title="Lock Force Released">
                    The lock previously held by {lockStatus?.lockedBy} has been released.
                </Alert>

                <Box marginTop={1}>
                    <Text color="gray">
                        Consider notifying the previous lock holder about this action.
                    </Text>
                </Box>

                <Footer actions={[{ key: 'Esc', label: 'back' }]} />

            </Box>
        );
    }

    return null;
}
```


## Index Export

```typescript
// src/cli/screens/lock/index.tsx

export { LockListScreen as default } from './LockListScreen';
export { LockAcquireScreen } from './LockAcquireScreen';
export { LockReleaseScreen } from './LockReleaseScreen';
export { LockForceScreen } from './LockForceScreen';
```


## Screen Layouts


### Lock List Screen (Lock Free)

```
┌─────────────────────────────────────────────────────────────────┐
│  Config   Change   Run   DB   [Lock]                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Lock Status                                              │   │
│  │                                                          │   │
│  │ Config: dev                                              │   │
│  │ Status: [FREE]                                           │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Actions                                                  │   │
│  │                                                          │   │
│  │ [a] Acquire Lock - Get exclusive access                  │   │
│  │ [R] Refresh - Reload lock status                         │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [a]acquire  [R]refresh  [Esc]back                              │
└─────────────────────────────────────────────────────────────────┘
```


### Lock List Screen (Locked by Another User)

```
┌─────────────────────────────────────────────────────────────────┐
│  Config   Change   Run   DB   [Lock]                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Lock Status                                              │   │
│  │                                                          │   │
│  │ Config: prod                                             │   │
│  │ Status: [LOCKED]                                         │   │
│  │ Held by: john@workstation                                │   │
│  │ Since: 2024-01-20 14:30:00 (2 hours ago)                 │   │
│  │ Reason: Adding payment tables                            │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Actions                                                  │   │
│  │                                                          │   │
│  │ [f] Force Release - Break another user's lock (danger)   │   │
│  │ [R] Refresh - Reload lock status                         │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ⚠ Lock Held by Another User                                    │
│  You cannot modify the schema while another user holds          │
│  the lock. Contact john@workstation to coordinate.              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [f]force  [R]refresh  [Esc]back                                │
└─────────────────────────────────────────────────────────────────┘
```


### Lock Acquire Screen

```
┌─────────────────────────────────────────────────────────────────┐
│  Config   Change   Run   DB   [Lock]                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Acquire Lock                                             │   │
│  │                                                          │   │
│  │ Acquiring a lock gives you exclusive access to modify    │   │
│  │ the schema. Other users will be blocked until you        │   │
│  │ release it.                                              │   │
│  │                                                          │   │
│  │ Config: dev                                              │   │
│  │                                                          │   │
│  │ Reason (optional):                                       │   │
│  │ ┌─────────────────────────────────────────────────────┐ │   │
│  │ │ Adding user roles table█                           │ │   │
│  │ └─────────────────────────────────────────────────────┘ │   │
│  │                                                          │   │
│  │ Providing a reason helps other team members understand   │   │
│  │ why the database is locked.                              │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Enter]acquire  [Esc]cancel                                    │
└─────────────────────────────────────────────────────────────────┘
```


### Lock Force Release Screen

```
┌─────────────────────────────────────────────────────────────────┐
│  Config   Change   Run   DB   [Lock]                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✖ Danger: Force Release Lock                                   │
│  This will forcibly break another user's lock. Only do this if: │
│  • The lock holder is unavailable                               │
│  • The lock appears to be stale/orphaned                        │
│  • You have coordinated with the lock holder                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Current Lock                                             │   │
│  │                                                          │   │
│  │ Held by: john@workstation                                │   │
│  │ Since: 2024-01-19 10:00:00 (28 hours ago)                │   │
│  │ Reason: Database migration                               │   │
│  │                                                          │   │
│  │ ⚠ This lock is over 24 hours old and may be stale.       │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Warning: Force releasing may cause conflicts if the lock       │
│  holder is actively working on schema changes.                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Enter]force release  [Esc]cancel                              │
└─────────────────────────────────────────────────────────────────┘
```


## Keyboard Shortcuts


### Lock List

| Key | Action |
|-----|--------|
| `a` | Acquire lock (when free) |
| `r` | Release lock (when own lock) |
| `f` | Force release (when another's lock) |
| `R` | Refresh status |
| `Esc` | Go back |


### Lock Acquire

| Key | Action |
|-----|--------|
| `Enter` | Confirm acquire |
| `Esc` | Cancel |


### Lock Release

| Key | Action |
|-----|--------|
| `y` | Confirm release |
| `n` / `Esc` | Cancel |


### Lock Force Release

| Key | Action |
|-----|--------|
| `Enter` | Proceed to confirm |
| `Esc` | Cancel |


## Observer Events

```typescript
// Lock events
observer.emit('lock:acquired', {
    config: string;
    reason?: string;
});

observer.emit('lock:released', {
    config: string;
});

observer.emit('lock:force-released', {
    config: string;
    previousHolder: string;
});

observer.emit('lock:status', {
    config: string;
    locked: boolean;
    holder?: string;
});
```


## Headless Mode Support

```typescript
// CLI commands
noorm lock:status [config]
noorm lock:acquire [config] [--reason "..."]
noorm lock:release [config]
noorm lock:force [config] [--yes]

// Examples
noorm lock:status dev
noorm lock:acquire prod --reason "Adding payment tables"
noorm lock:release prod
noorm lock:force staging --yes
```


## Testing

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { LockListScreen } from './LockListScreen';
import { LockAcquireScreen } from './LockAcquireScreen';
import { LockForceScreen } from './LockForceScreen';
import { RouterProvider } from '../../router';

describe('LockListScreen', () => {

    it('should show free status when no lock', async () => {

        const { lastFrame } = render(
            <RouterProvider>
                <LockListScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('FREE');
        expect(lastFrame()).toContain('[a] Acquire');
    });

    it('should show locked status with holder info', async () => {

        // Mock locked status
        const { lastFrame } = render(
            <RouterProvider>
                <LockListScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('LOCKED');
        expect(lastFrame()).toContain('Held by:');
    });
});

describe('LockAcquireScreen', () => {

    it('should accept optional reason', async () => {

        const { lastFrame, stdin } = render(
            <RouterProvider>
                <LockAcquireScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('Reason (optional)');
    });
});

describe('LockForceScreen', () => {

    it('should show warning about stale locks', async () => {

        const { lastFrame } = render(
            <RouterProvider>
                <LockForceScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('Danger');
        expect(lastFrame()).toContain('Force Release');
    });

    it('should require protected confirm', async () => {

        const { lastFrame, stdin } = render(
            <RouterProvider>
                <LockForceScreen />
            </RouterProvider>
        );

        await new Promise(r => setTimeout(r, 100));

        stdin.write('\r'); // Enter

        await new Promise(r => setTimeout(r, 50));

        expect(lastFrame()).toContain('yes-');
    });
});
```
