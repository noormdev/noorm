import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';

import { checkConfigPolicy, confirmationPhraseFor, getPolicyFingerprint } from '../../../core/policy/index.js';
import { useAppContext } from '../../app-context.js';
import { Panel, ProtectedConfirm } from '../../components/index.js';
import { useFocusScope } from '../../focus.js';
import { useRouter } from '../../router.js';

/** Gate local secret metadata and values before a screen reads either. */
export function SecretReadGate({ children }: { children: ReactElement }): ReactElement {

    const { activeConfig, activeConfigName } = useAppContext();
    const { back } = useRouter();
    const [approved, setApproved] = useState<string | null>(null);
    const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'secret:read') : null;
    const fingerprint = activeConfig ? `${activeConfigName}:${getPolicyFingerprint(activeConfig)}` : null;
    const blocked = check && !check.allowed;
    const gated = !!check && (!!blocked || (check.requiresConfirmation && approved !== fingerprint));
    const { isFocused } = useFocusScope({ label: 'SecretReadGate', skip: !gated });

    useInput((_input, key) => {

        if (isFocused && blocked && (key.escape || key.return)) back();

    });

    if (!activeConfig || !check || (!blocked && (!check.requiresConfirmation || approved === fingerprint))) {

        return children;

    }

    if (blocked) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Secrets" borderColor="red">
                    <Text color="red">{check.blockedReason ?? 'Secret read is not allowed'}</Text>
                </Panel>
                <Text dimColor>[Enter/Esc] Back</Text>
            </Box>
        );

    }

    return (
        <ProtectedConfirm
            configName={activeConfigName ?? activeConfig.name}
            confirmPhrase={check.confirmationPhrase ?? confirmationPhraseFor(activeConfigName ?? activeConfig.name)}
            action="read secrets"
            onConfirm={() => setApproved(fingerprint)}
            onCancel={back}
            isFocused={isFocused}
        />
    );

}
