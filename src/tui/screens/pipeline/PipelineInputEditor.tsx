import type { ReactElement } from 'react';
import { attemptSync } from '@logosdx/utils';
import { Box, Text } from 'ink';
import { Form } from '../../components/forms/Form.js';
import type { FormField } from '../../components/forms/Form.js';
import { parsePipelineInputText, validatePipelineInputValue } from '../../../core/pipeline/input.js';
import type { PipelineInputDeclaration, PipelineJsonValue } from '../../../core/pipeline/types.js';
import { oneLine } from '../../utils/string.js';

/**
 * Edits one input override and saves only a value that passes the declaration's type and choices,
 * so the run screen never holds an override that resolution would reject.
 *
 * @example
 * <PipelineInputEditor name="cutoff" declaration={definition.inputs.cutoff} overrides={overrides}
 *     onSave={(value) => setOverrides({ ...overrides, cutoff: value })} onCancel={() => setEditing(null)} />
 */
export function PipelineInputEditor({ name, declaration, overrides, onSave, onCancel }: {
    name: string;
    declaration: PipelineInputDeclaration;
    overrides: Record<string, PipelineJsonValue>;
    onSave: (value: PipelineJsonValue) => void;
    onCancel: () => void;
}): ReactElement {

    const initial = Object.hasOwn(overrides, name) ? overrides[name] : declaration.default;
    const choices = declaration.choices;
    const decode = (raw: string | boolean): PipelineJsonValue => {

        if (choices) {

            const index = typeof raw === 'string' && /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : -1;
            const value = choices[index];
            validatePipelineInputValue(name, declaration, value);

            return value;

        }

        return parsePipelineInputText(name, declaration, raw);

    };
    const field: FormField = {
        key: 'value', label: name, type: choices ? 'select' : declaration.type === 'boolean' ? 'checkbox' : 'text',
        defaultValue: choices ? String(Math.max(0, choices.findIndex((value) => value === initial)))
            : declaration.type === 'boolean' ? initial === true
                : initial === undefined ? '' : declaration.type === 'string' ? String(initial) : JSON.stringify(initial),
        ...(choices ? { options: choices.map((value, index) => ({ label: JSON.stringify(value), value: String(index) })) } : {}),
        validate: (raw) => {

            const [, invalid] = attemptSync(() => decode(raw));

            return invalid ? `Invalid ${declaration.type} value for ${name}` : undefined;

        },
    };

    return <Box flexDirection="column" gap={1}>
        <Text wrap="truncate">{oneLine(declaration.description)}</Text>
        <Text dimColor>{declaration.type} · {declaration.required ? 'Required presence' : 'Optional'} · Save explicitly supplies this value.</Text>
        <Form key={name} fields={[field]} submitLabel="Save" onSubmit={(values) => onSave(decode(values['value'] ?? ''))}
            onCancel={onCancel} focusLabel={`Pipeline input: ${name}`} />
    </Box>;

}
