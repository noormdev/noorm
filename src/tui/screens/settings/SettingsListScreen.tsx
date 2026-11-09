/**
 * SettingsListScreen - displays project settings sections.
 *
 * Shows aligned section, purpose, and current-value columns.
 * Keyboard shortcuts provide quick access to actions:
 * - Enter: Edit selected section
 * - i: Initialize/reset settings file
 *
 * @example
 * ```bash
 * noorm settings           # Opens this screen
 * ```
 */
import { useCallback, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps, Route } from '../../types.js';

import type { Settings } from '../../../core/settings/types.js';

import { useRouter } from '../../router.js';
import { useFocusScope } from '../../focus.js';
import { useAppContext } from '../../app-context.js';
import { Panel, SelectList, type SelectListItem } from '../../components/index.js';
import { DEFAULT_CHANGES_PATH, DEFAULT_SQL_PATH } from '../../../core/settings/defaults.js';
import { BUILTIN_ROLES, isBuiltinRole } from '../../../core/policy/index.js';
import { rowBudget } from '../../components/terminal/viewport.js';

/**
 * Settings section item value.
 */
interface SettingsSectionValue {
    key: string;
    route: Route;
    summary: string;
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

    return `schema: ${paths.sql ?? DEFAULT_SQL_PATH}, changes: ${paths.changes ?? DEFAULT_CHANGES_PATH}`;

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

function accessSectionSummary(settings: Settings | null): string {

    if (!settings) return 'Not loaded';
    const roles = settings.access?.roles ?? {};
    const customCount = Object.keys(roles).filter((name) => !isBuiltinRole(name)).length;
    const overrideCount = Object.values(roles).reduce((count, role) => count + Object.keys(role.permissions ?? {}).length, 0);

    return `${BUILTIN_ROLES.length + customCount} roles, ${overrideCount} overrides`;

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

    return `${logging.level ?? 'info'} → ${logging.file ?? '.noorm/state/noorm.log'}`;

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

    const { columns: terminalColumns } = useWindowSize();
    // Panel chrome is shared; the numbered SelectList owns four more columns.
    const tableWidth = Math.max(1, rowBudget(terminalColumns) - 4);
    const sectionWidth = Math.min(14, Math.floor(tableWidth / 3));
    const showPurpose = tableWidth >= 64;
    const remainingWidth = tableWidth - sectionWidth - (showPurpose ? 6 : 3);
    const purposeWidth = showPurpose ? Math.min(30, Math.floor(remainingWidth * 0.48)) : 0;
    const currentWidth = Math.max(1, remainingWidth - purposeWidth);

    // Build section items with summaries (depend on settings to re-render after changes)
    const items: SelectListItem<SettingsSectionValue>[] = useMemo(
        () => [
            {
                key: 'build',
                label: 'Build',
                value: { key: 'build', route: 'settings/build' as Route, summary: buildSectionSummary(settings) },
                description: 'Schema build files',
            },
            {
                key: 'paths',
                label: 'Paths',
                value: { key: 'paths', route: 'settings/paths' as Route, summary: pathsSectionSummary(settings) },
                description: 'SQL / change directories',
            },
            {
                key: 'stages',
                label: 'Stages',
                value: { key: 'stages', route: 'settings/stages' as Route, summary: stagesSectionSummary(settings) },
                description: 'Environment defaults',
            },
            {
                key: 'access',
                label: 'Access Roles',
                value: { key: 'access', route: 'settings/access' as Route, summary: accessSectionSummary(settings) },
                description: 'Roles and permissions',
            },
            {
                key: 'rules',
                label: 'Rules',
                value: { key: 'rules', route: 'settings/rules' as Route, summary: rulesSectionSummary(settings) },
                description: 'Conditional build paths',
            },
            {
                key: 'strict',
                label: 'Strict',
                value: { key: 'strict', route: 'settings/strict' as Route, summary: strictSectionSummary(settings) },
                description: 'Required stages',
            },
            {
                key: 'logging',
                label: 'Logging',
                value: { key: 'logging', route: 'settings/logging' as Route, summary: loggingSectionSummary(settings) },
                description: 'File logging',
            },
            {
                key: 'secrets',
                label: 'Secrets',
                value: { key: 'secrets', route: 'settings/secrets' as Route, summary: secretsSectionSummary(settings) },
                description: 'Required project secrets',
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

    const renderColumns = (section: string, purpose: string, current: string, heading = false): ReactElement => (
        <Box width={tableWidth} flexShrink={0}>
            <Box width={sectionWidth} flexShrink={0}>
                <Text bold={heading} wrap="truncate">{section}</Text>
            </Box>
            {showPurpose && (
                <>
                    <Text dimColor> │ </Text>
                    <Box width={purposeWidth} flexShrink={0}>
                        <Text bold={heading} wrap="truncate">{purpose}</Text>
                    </Box>
                </>
            )}
            <Text dimColor> │ </Text>
            <Box width={currentWidth} flexShrink={0}>
                <Text bold={heading} wrap="truncate">{current}</Text>
            </Box>
        </Box>
    );

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title="Settings" paddingX={1} paddingY={1}>
                <Box marginLeft={4}>
                    {renderColumns('Section', 'Purpose', 'Current value', true)}
                </Box>
                <Box marginLeft={4}>
                    <Text dimColor>{'─'.repeat(tableWidth)}</Text>
                </Box>
                <SelectList
                    items={items}
                    onSelect={handleSelect}
                    isFocused={isFocused}
                    numberNav
                    reserveRows={2}
                    renderItem={(item) => renderColumns(item.label, item.description ?? '', item.value.summary)}
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
