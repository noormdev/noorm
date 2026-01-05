/**
 * SettingsListScreen - displays project settings sections.
 *
 * Shows a list of settings sections (build, paths, stages, rules, strict, logging)
 * with summaries. Keyboard shortcuts provide quick access to actions:
 * - Enter: Edit selected section
 * - i: Initialize/reset settings file
 *
 * @example
 * ```bash
 * noorm settings           # Opens this screen
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps, Route } from '../../types.js';

import type { Settings } from '../../../core/settings/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SelectList, type SelectListItem } from '../../components/index.js';

/**
 * Settings section item value.
 */
interface SettingsSectionValue {
    key: string;
    route: Route;
}

/**
 * Build section summary.
 */
function buildSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';

    const build = settings.build ?? {};
    const includeCount = build.include?.length ?? 0;
    const excludeCount = build.exclude?.length ?? 0;

    return `include: ${includeCount}, exclude: ${excludeCount}`;

}

/**
 * Paths section summary.
 */
function pathsSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';

    const paths = settings.paths ?? {};

    return `schema: ${paths.sql ?? './sql'}, changes: ${paths.changes ?? './changes'}`;

}

/**
 * Stages section summary.
 */
function stagesSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';

    const stages = settings.stages ?? {};
    const names = Object.keys(stages);

    if (names.length === 0) return 'none defined';

    if (names.length <= 3) {

        return `${names.join(', ')} (${names.length})`;

    }

    return `${names.slice(0, 3).join(', ')}... (${names.length})`;

}

/**
 * Rules section summary.
 */
function rulesSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';

    const rules = settings.rules ?? [];

    if (rules.length === 0) return 'none configured';

    return `${rules.length} configured`;

}

/**
 * Strict section summary.
 */
function strictSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';

    const strict = settings.strict ?? {};

    if (!strict.enabled) return 'disabled';

    const stageCount = strict.stages?.length ?? 0;

    return `enabled (${stageCount} required stages)`;

}

/**
 * Logging section summary.
 */
function loggingSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';

    const logging = settings.logging ?? {};

    if (!logging.enabled) return 'disabled';

    return `${logging.level ?? 'info'} → ${logging.file ?? '.noorm/noorm.log'}`;

}

/**
 * Secrets section summary.
 */
function secretsSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';

    const secrets = settings.secrets ?? [];

    if (secrets.length === 0) return 'none defined';

    return `${secrets.length} universal`;

}

/**
 * SettingsListScreen component.
 *
 * Displays all settings sections with quick navigation.
 */
export function SettingsListScreen({ params: _params }: ScreenProps): ReactElement {

    const { navigate, back } = useRouter();
    const { isFocused } = useFocusScope('SettingsList');
    const { settings } = useAppContext();

    // Track highlighted section for keyboard actions
    const [_highlightedSection, setHighlightedSection] = useState<string>('build');

    // Build section items with summaries (depend on settings to re-render after changes)
    const items: SelectListItem<SettingsSectionValue>[] = useMemo(
        () => [
            {
                key: 'build',
                label: 'Build',
                value: { key: 'build', route: 'settings/build' as Route },
                description: buildSectionSummary(settings),
            },
            {
                key: 'paths',
                label: 'Paths',
                value: { key: 'paths', route: 'settings/paths' as Route },
                description: pathsSectionSummary(settings),
            },
            {
                key: 'stages',
                label: 'Stages',
                value: { key: 'stages', route: 'settings/stages' as Route },
                description: stagesSectionSummary(settings),
            },
            {
                key: 'rules',
                label: 'Rules',
                value: { key: 'rules', route: 'settings/rules' as Route },
                description: rulesSectionSummary(settings),
            },
            {
                key: 'strict',
                label: 'Strict',
                value: { key: 'strict', route: 'settings/strict' as Route },
                description: strictSectionSummary(settings),
            },
            {
                key: 'logging',
                label: 'Logging',
                value: { key: 'logging', route: 'settings/logging' as Route },
                description: loggingSectionSummary(settings),
            },
            {
                key: 'secrets',
                label: 'Secrets',
                value: { key: 'secrets', route: 'settings/secrets' as Route },
                description: secretsSectionSummary(settings),
            },
        ],
        [settings],
    );

    // Handle section selection (Enter) - navigate to section editor
    const handleSelect = useCallback(
        (item: SelectListItem<SettingsSectionValue>) => {

            navigate(item.value.route);

        },
        [navigate],
    );

    // Handle highlight change
    const handleHighlight = useCallback((item: SelectListItem<SettingsSectionValue>) => {

        setHighlightedSection(item.value.key);

    }, []);

    // Keyboard shortcuts
    useInput((input, key) => {

        if (!isFocused) return;

        // ESC to go back
        if (key.escape) {

            back();

            return;

        }

        // Initialize settings
        if (input === 'i') {

            navigate('settings/init');

            return;

        }

    });

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Settings" paddingX={1} paddingY={1}>
                <SelectList
                    items={items}
                    onSelect={handleSelect}
                    onHighlight={handleHighlight}
                    isFocused={isFocused}
                    visibleCount={8}
                    numberNav
                />
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Enter] Edit</Text>
                <Text dimColor>[i] Init</Text>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
