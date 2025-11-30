import type { ReactNode } from 'react';
import { useState } from 'react';
import { HomeScreen, SettingsScreen, AboutScreen } from './screens/index.js';
import type { Screen } from './types.js';

export function App() {
    const [screen, setScreen] = useState<Screen>('home');

    const screens: Record<Screen, ReactNode> = {
        home: <HomeScreen onNavigate={setScreen} />,
        settings: <SettingsScreen onNavigate={setScreen} />,
        about: <AboutScreen onNavigate={setScreen} />,
    };

    return <>{screens[screen]}</>;
}
