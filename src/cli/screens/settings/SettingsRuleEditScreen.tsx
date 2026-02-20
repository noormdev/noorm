/**
 * SettingsRuleEditScreen - add or edit a rule definition.
 *
 * Rules conditionally include/exclude paths based on config properties.
 *
 * @example
 * ```bash
 * noorm settings rules add    # Add new rule
 * noorm settings rules edit 0 # Edit first rule
 * ```
 */
import { useCallback, useMemo } from 'react';
import { Text } from 'ink';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../types.js';
import type { FormValues, FormField } from '../../components/index.js';
import type { Rule } from '../../../core/settings/types.js';

import { useRouter } from '../../router.js';
import { useAppContext } from '../../app-context.js';
import { Panel, Form } from '../../components/index.js';
import { useSettingsOperation } from '../../hooks/index.js';

/**
 * Parse comma-separated string to array.
 */
function parsePathList(value: unknown): string[] {

    if (typeof value !== 'string' || !value.trim()) return [];

    return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

}

/**
 * Format array to comma-separated string.
 */
function formatPathList(paths: string[] | undefined): string {

    if (!paths || paths.length === 0) return '';

    return paths.join(', ');

}

/**
 * SettingsRuleEditScreen component.
 */
export function SettingsRuleEditScreen({ params }: ScreenProps): ReactElement {

    const { back } = useRouter();
    const { settingsManager } = useAppContext();

    // Parse rule index from params.name
    const ruleIndexStr = params.name;
    const ruleIndex = ruleIndexStr !== undefined ? parseInt(ruleIndexStr, 10) : NaN;
    const isAddMode = isNaN(ruleIndex);

    const { execute, busy, error } = useSettingsOperation(
        async (mgr, rule: Rule) => {

            if (isAddMode) {

                await mgr.addRule(rule);

            }
            else {

                await mgr.removeRule(ruleIndex);
                await mgr.addRule(rule);

            }

        },
        isAddMode ? 'Rule created' : 'Rule updated',
    );

    // Get all rules
    const rules = useMemo(() => {

        if (!settingsManager) return [];

        return settingsManager.getRules();

    }, [settingsManager]);

    // Get existing rule if editing
    const existingRule = useMemo(() => {

        if (isAddMode || ruleIndex < 0 || ruleIndex >= rules.length) return null;

        return rules[ruleIndex];

    }, [rules, ruleIndex, isAddMode]);

    // Form fields
    const fields: FormField[] = useMemo(() => {

        const match = existingRule?.match ?? {};

        return [
            {
                key: 'description',
                label: 'Description',
                type: 'text',
                defaultValue: existingRule?.description ?? '',
                placeholder: 'e.g., test seeds, prod config',
            },
            {
                key: 'matchName',
                label: 'Match: Config Name',
                type: 'text',
                defaultValue: match.name ?? '',
                placeholder: 'e.g., dev, prod (leave empty to match any)',
            },
            {
                key: 'matchType',
                label: 'Match: Connection Type',
                type: 'select',
                options: [
                    { label: '(any)', value: '' },
                    { label: 'Local', value: 'local' },
                    { label: 'Remote', value: 'remote' },
                ],
                defaultValue: match.type ?? '',
            },
            {
                key: 'matchIsTest',
                label: 'Match: Is Test Database',
                type: 'select',
                options: [
                    { label: '(any)', value: '' },
                    { label: 'Yes', value: 'true' },
                    { label: 'No', value: 'false' },
                ],
                defaultValue: match.isTest !== undefined ? String(match.isTest) : '',
            },
            {
                key: 'matchProtected',
                label: 'Match: Is Protected',
                type: 'select',
                options: [
                    { label: '(any)', value: '' },
                    { label: 'Yes', value: 'true' },
                    { label: 'No', value: 'false' },
                ],
                defaultValue: match.protected !== undefined ? String(match.protected) : '',
            },
            {
                key: 'include',
                label: 'Include Paths (comma-separated)',
                type: 'text',
                defaultValue: formatPathList(existingRule?.include),
                placeholder: 'sql/seeds, sql/fixtures',
            },
            {
                key: 'exclude',
                label: 'Exclude Paths (comma-separated)',
                type: 'text',
                defaultValue: formatPathList(existingRule?.exclude),
                placeholder: 'sql/dangerous, sql/archive',
            },
        ];

    }, [existingRule]);

    // Handle form submission
    const handleSubmit = useCallback(
        async (values: FormValues) => {

            // Build match object (only include non-empty values)
            const match: Rule['match'] = {};

            if (values['matchName']) match.name = String(values['matchName']);
            if (values['matchType']) match.type = String(values['matchType']) as 'local' | 'remote';

            if (values['matchIsTest'] === 'true') match.isTest = true;
            if (values['matchIsTest'] === 'false') match.isTest = false;
            if (values['matchProtected'] === 'true') match.protected = true;
            if (values['matchProtected'] === 'false') match.protected = false;

            const include = parsePathList(values['include']);
            const exclude = parsePathList(values['exclude']);

            const description = values['description'] ? String(values['description']) : undefined;

            const rule: Rule = {
                description,
                match,
                include: include.length > 0 ? include : undefined,
                exclude: exclude.length > 0 ? exclude : undefined,
            };

            await execute(rule);

        },
        [execute],
    );

    // Handle cancel
    const handleCancel = useCallback(() => {

        back();

    }, [back]);

    // Editing non-existent rule
    if (!isAddMode && !existingRule) {

        return (
            <Panel title="Edit Rule" paddingX={2} paddingY={1} borderColor="red">
                <Text color="red">Rule {ruleIndex + 1} not found.</Text>
            </Panel>
        );

    }

    // Panel title: use description if available, otherwise "Rule N"
    const ruleLabel = existingRule?.description || `Rule ${ruleIndex + 1}`;

    return (
        <Panel title={isAddMode ? 'Add Rule' : `Edit: ${ruleLabel}`} paddingX={2} paddingY={1}>
            <Form
                fields={fields}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                submitLabel={isAddMode ? 'Create Rule' : 'Save Changes'}
                focusLabel="SettingsRuleEditForm"
                busy={busy}
                busyLabel="Saving..."
                statusError={error ?? undefined}
            />
        </Panel>
    );

}
