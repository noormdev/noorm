# CLI Home Screen


## Overview

The home screen is the default landing page when launching `noorm` without arguments. It provides:

- Active config display
- Quick status overview
- Section navigation via tabs
- Quick actions


## File Structure

```
src/cli/screens/
├── home/
│   ├── index.tsx          # Main home screen export
│   ├── HomeScreen.tsx     # Home screen component
│   ├── QuickStatus.tsx    # Status summary widget
│   └── RecentActivity.tsx # Recent operations widget
```


## Home Screen

```typescript
// src/cli/screens/home/HomeScreen.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useRouter } from '../../router';
import { useScreenInput } from '../../keyboard';
import { Footer, Panel, Badge, SelectList, Divider } from '../../components';
import { QuickStatus } from './QuickStatus';
import { RecentActivity } from './RecentActivity';
import { getStateManager } from '../../../core/state';
import { attempt } from '@logosdx/utils';

interface HomeState {
    loading: boolean;
    activeConfig: string | null;
    configCount: number;
    error: string | null;
}

export function HomeScreen() {

    const { navigate } = useRouter();
    const [state, setState] = useState<HomeState>({
        loading: true,
        activeConfig: null,
        configCount: 0,
        error: null,
    });

    // Load state on mount
    useEffect(() => {

        loadState();
    }, []);

    async function loadState() {

        const [manager, err] = await attempt(async () => {

            const mgr = await getStateManager();
            await mgr.load();
            return mgr;
        });

        if (err) {

            setState({
                loading: false,
                activeConfig: null,
                configCount: 0,
                error: err.message,
            });
            return;
        }

        const configs = manager!.listConfigs();
        const active = manager!.getActiveConfig();

        setState({
            loading: false,
            activeConfig: active?.name ?? null,
            configCount: configs.length,
            error: null,
        });
    }

    // Keyboard shortcuts
    useScreenInput({
        'c': () => navigate('config'),
        'h': () => navigate('change'),
        'r': () => navigate('run'),
        'd': () => navigate('db'),
        'l': () => navigate('lock'),
        '1': () => navigate('config'),
        '2': () => navigate('change'),
        '3': () => navigate('run'),
        '4': () => navigate('db'),
        '5': () => navigate('lock'),
    }, [navigate]);

    if (state.loading) {

        return (
            <Box flexDirection="column">
                <Text>Loading...</Text>
            </Box>
        );
    }

    if (state.error) {

        return (
            <Box flexDirection="column">
                <Text color="red">Error: {state.error}</Text>
                <Text color="gray" marginTop={1}>
                    Run `noorm config:add` to create your first configuration.
                </Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">

            <WelcomeSection
                activeConfig={state.activeConfig}
                configCount={state.configCount}
            />

            <Box marginTop={1} gap={2}>

                <Box flexDirection="column" width="50%">
                    <QuickStatus activeConfig={state.activeConfig} />
                </Box>

                <Box flexDirection="column" width="50%">
                    <QuickActions onNavigate={navigate} />
                </Box>

            </Box>

            {state.activeConfig && (
                <Box marginTop={1}>
                    <RecentActivity configName={state.activeConfig} />
                </Box>
            )}

            <Footer
                actions={[
                    { key: 'c', label: 'config' },
                    { key: 'h', label: 'change' },
                    { key: 'r', label: 'run' },
                    { key: 'd', label: 'db' },
                    { key: 'l', label: 'lock' },
                ]}
            />

        </Box>
    );
}

interface WelcomeSectionProps {
    activeConfig: string | null;
    configCount: number;
}

function WelcomeSection({ activeConfig, configCount }: WelcomeSectionProps) {

    return (
        <Box flexDirection="column">

            <Text bold>Welcome to noorm</Text>

            <Box marginTop={1} gap={2}>

                <Box>
                    <Text color="gray">Active Config: </Text>
                    {activeConfig ? (
                        <Text color="cyan" bold>{activeConfig}</Text>
                    ) : (
                        <Text color="yellow">None selected</Text>
                    )}
                </Box>

                <Box>
                    <Text color="gray">Configs: </Text>
                    <Text>{configCount}</Text>
                </Box>

            </Box>

            {!activeConfig && configCount === 0 && (
                <Box marginTop={1}>
                    <Text color="yellow">
                        Get started by pressing <Text bold>c</Text> to add a configuration.
                    </Text>
                </Box>
            )}

            {!activeConfig && configCount > 0 && (
                <Box marginTop={1}>
                    <Text color="yellow">
                        Press <Text bold>c</Text> to select an active configuration.
                    </Text>
                </Box>
            )}

        </Box>
    );
}

interface QuickActionsProps {
    onNavigate: (route: any) => void;
}

function QuickActions({ onNavigate }: QuickActionsProps) {

    const actions = [
        { key: '1', label: 'Run Build', route: 'run/build', description: 'Build schema from scratch' },
        { key: '2', label: 'Apply Changes', route: 'change/ff', description: 'Fast-forward all pending' },
        { key: '3', label: 'View Status', route: 'lock/status', description: 'Check lock status' },
    ];

    return (
        <Panel title="Quick Actions">

            <Box flexDirection="column">
                {actions.map(action => (

                    <Box key={action.key}>
                        <Text color="yellow">[{action.key}] </Text>
                        <Text>{action.label}</Text>
                        <Text color="gray"> - {action.description}</Text>
                    </Box>
                ))}
            </Box>

        </Panel>
    );
}

export default HomeScreen;
```


## Quick Status Widget

```typescript
// src/cli/screens/home/QuickStatus.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Panel, Badge, Spinner } from '../../components';
import { createConnection } from '../../../core/connection';
import { ChangesetManager } from '../../../core/changeset';
import { LockManager } from '../../../core/lock';
import { getStateManager } from '../../../core/state';
import { attempt } from '@logosdx/utils';

export interface QuickStatusProps {
    activeConfig: string | null;
}

interface StatusData {
    loading: boolean;
    connected: boolean;
    pendingChangesets: number;
    locked: boolean;
    lockHolder?: string;
    error?: string;
}

export function QuickStatus({ activeConfig }: QuickStatusProps) {

    const [status, setStatus] = useState<StatusData>({
        loading: true,
        connected: false,
        pendingChangesets: 0,
        locked: false,
    });

    useEffect(() => {

        if (!activeConfig) {

            setStatus({
                loading: false,
                connected: false,
                pendingChangesets: 0,
                locked: false,
            });
            return;
        }

        loadStatus(activeConfig);
    }, [activeConfig]);

    async function loadStatus(configName: string) {

        const [state, stateErr] = await attempt(async () => {

            const mgr = await getStateManager();
            return mgr.getConfig(configName);
        });

        if (stateErr || !state) {

            setStatus({
                loading: false,
                connected: false,
                pendingChangesets: 0,
                locked: false,
                error: stateErr?.message ?? 'Config not found',
            });
            return;
        }

        // Try to connect and get status
        const [conn, connErr] = await attempt(() =>
            createConnection(state.connection, configName)
        );

        if (connErr) {

            setStatus({
                loading: false,
                connected: false,
                pendingChangesets: 0,
                locked: false,
            });
            return;
        }

        // Get pending changesets
        const changesetMgr = new ChangesetManager(conn!.db, state);
        const [pending] = await attempt(() => changesetMgr.getPending());

        // Get lock status
        const lockMgr = new LockManager(conn!.db, state.connection.dialect, configName);
        const [lockStatus] = await attempt(() => lockMgr.getStatus());

        await conn!.destroy();

        setStatus({
            loading: false,
            connected: true,
            pendingChangesets: pending?.length ?? 0,
            locked: !!lockStatus,
            lockHolder: lockStatus?.lockedBy,
        });
    }

    if (!activeConfig) {

        return (
            <Panel title="Status">
                <Text color="gray">No active configuration</Text>
            </Panel>
        );
    }

    if (status.loading) {

        return (
            <Panel title="Status">
                <Spinner label="Loading status..." />
            </Panel>
        );
    }

    return (
        <Panel title="Status">

            <Box flexDirection="column" gap={1}>

                <Box>
                    <Text>Connection: </Text>
                    <Badge
                        label={status.connected ? 'OK' : 'ERROR'}
                        variant={status.connected ? 'success' : 'error'}
                    />
                </Box>

                <Box>
                    <Text>Pending: </Text>
                    {status.pendingChangesets > 0 ? (
                        <Badge
                            label={`${status.pendingChangesets} changeset${status.pendingChangesets > 1 ? 's' : ''}`}
                            variant="warning"
                        />
                    ) : (
                        <Badge label="Up to date" variant="success" />
                    )}
                </Box>

                <Box>
                    <Text>Lock: </Text>
                    {status.locked ? (
                        <Box>
                            <Badge label="LOCKED" variant="error" />
                            <Text color="gray"> by {status.lockHolder}</Text>
                        </Box>
                    ) : (
                        <Badge label="FREE" variant="success" />
                    )}
                </Box>

            </Box>

        </Panel>
    );
}
```


## Recent Activity Widget

```typescript
// src/cli/screens/home/RecentActivity.tsx

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Panel, StatusList, Spinner } from '../../components';
import { createConnection } from '../../../core/connection';
import { ChangesetHistory } from '../../../core/changeset';
import { getStateManager } from '../../../core/state';
import { attempt } from '@logosdx/utils';

export interface RecentActivityProps {
    configName: string;
    limit?: number;
}

interface ActivityItem {
    key: string;
    label: string;
    status: 'success' | 'failed';
    detail: string;
}

export function RecentActivity({ configName, limit = 5 }: RecentActivityProps) {

    const [loading, setLoading] = useState(true);
    const [activities, setActivities] = useState<ActivityItem[]>([]);

    useEffect(() => {

        loadActivity();
    }, [configName]);

    async function loadActivity() {

        const [state] = await attempt(async () => {

            const mgr = await getStateManager();
            return mgr.getConfig(configName);
        });

        if (!state) {

            setLoading(false);
            return;
        }

        const [conn] = await attempt(() =>
            createConnection(state.connection, configName)
        );

        if (!conn) {

            setLoading(false);
            return;
        }

        const history = new ChangesetHistory(conn.db, configName);
        const [records] = await attempt(() => history.getAllRecords());

        await conn.destroy();

        if (!records) {

            setLoading(false);
            return;
        }

        const items: ActivityItem[] = records.slice(0, limit).map(r => ({
            key: `${r.changesetName}-${r.direction}-${r.executedAt.getTime()}`,
            label: `${r.direction === 'change' ? 'Applied' : 'Reverted'} ${r.changesetName}`,
            status: r.status,
            detail: formatTimeAgo(r.executedAt),
        }));

        setActivities(items);
        setLoading(false);
    }

    if (loading) {

        return (
            <Panel title="Recent Activity">
                <Spinner label="Loading..." />
            </Panel>
        );
    }

    if (activities.length === 0) {

        return (
            <Panel title="Recent Activity">
                <Text color="gray">No recent activity</Text>
            </Panel>
        );
    }

    return (
        <Panel title="Recent Activity">
            <StatusList items={activities} />
        </Panel>
    );
}

function formatTimeAgo(date: Date): string {

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}
```


## Index Export

```typescript
// src/cli/screens/home/index.tsx

export { HomeScreen as default } from './HomeScreen';
export { QuickStatus } from './QuickStatus';
export { RecentActivity } from './RecentActivity';
```


## Screen Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  noorm - Database Schema & Changeset Manager                    │
│  ───────────────────────────────────────────────────────────────│
│  [Config]  Change   Run   DB   Lock                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Welcome to noorm                                               │
│                                                                 │
│  Active Config: dev          Configs: 3                         │
│                                                                 │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐   │
│  │ Status                  │  │ Quick Actions               │   │
│  │                         │  │                             │   │
│  │ Connection: [OK]        │  │ [1] Run Build               │   │
│  │ Pending: [2 changesets] │  │ [2] Apply Changes           │   │
│  │ Lock: [FREE]            │  │ [3] View Status             │   │
│  │                         │  │                             │   │
│  └─────────────────────────┘  └─────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Recent Activity                                          │   │
│  │                                                          │   │
│  │ ✓ Applied 2024-01-20_add-roles         2h ago           │   │
│  │ ✓ Applied 2024-01-15_add-email         1d ago           │   │
│  │ ✗ Reverted 2024-01-10_test             3d ago           │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [c]config  [h]change  [r]run  [d]db  [l]lock  [?]help  [q]quit │
└─────────────────────────────────────────────────────────────────┘
```


## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `c` | Go to Config section |
| `h` | Go to Change section |
| `r` | Go to Run section |
| `d` | Go to DB section |
| `l` | Go to Lock section |
| `1-5` | Quick navigate to sections |
| `Tab` | Next section |
| `Shift+Tab` | Previous section |
| `?` | Show help |
| `q` | Quit |


## State Management

The home screen loads minimal state on mount:

1. Load `StateManager` to get active config
2. If active config exists:
   - Test connection
   - Count pending changesets
   - Check lock status
3. Load recent activity from history table

All database connections are closed after status check to avoid holding connections open.


## Testing

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { HomeScreen } from './HomeScreen';
import { RouterProvider } from '../../router';

describe('HomeScreen', () => {

    it('should show welcome message', () => {

        const { lastFrame } = render(
            <RouterProvider>
                <HomeScreen />
            </RouterProvider>
        );

        expect(lastFrame()).toContain('Welcome to noorm');
    });

    it('should show no config message when none exists', async () => {

        // Mock getStateManager to return empty state
        const { lastFrame } = render(
            <RouterProvider>
                <HomeScreen />
            </RouterProvider>
        );

        // Wait for loading
        await new Promise(r => setTimeout(r, 100));

        expect(lastFrame()).toContain('add a configuration');
    });

    it('should navigate on keyboard shortcut', () => {

        const { stdin, lastFrame } = render(
            <RouterProvider>
                <HomeScreen />
            </RouterProvider>
        );

        stdin.write('c');

        // Should navigate to config
        // Test navigation occurred
    });
});
```
