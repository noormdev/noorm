/** The policy the vault set and remove screens share: editing a secret reads the vault key before it writes. */
import { Box, Text } from 'ink';
import type { ReactElement } from 'react';

import { Panel } from '../../components/index.js';
import { checkConfigPolicy } from '../../../core/policy/index.js';
import type { ConfigAccess, PolicyCheck } from '../../../core/policy/index.js';

const VAULT_EDIT_PERMISSIONS = ['vault:read', 'vault:write'] as const;

export type VaultEditPermission = (typeof VAULT_EDIT_PERMISSIONS)[number];

type VaultConfig = { name: string; access?: ConfigAccess };

/**
 * The check that refuses the role outright, if any. A refused screen must not
 * connect: connecting prepares the tracking tables.
 *
 * @example
 * const denied = vaultEditRefusal(activeConfig);
 * const vault = useVaultConnection({ enabled: !denied });
 */
export function vaultEditRefusal(config: VaultConfig | null): PolicyCheck | undefined {

    if (!config) return undefined;

    return VAULT_EDIT_PERMISSIONS
        .map((permission) => checkConfigPolicy('user', config, permission))
        .find((check) => !check.allowed);

}

/**
 * The next permission the user still has to confirm before the edit runs.
 *
 * @example
 * const pending = vaultEditConfirmation(activeConfig, { 'vault:read': true, 'vault:write': false });
 * if (pending) setPendingPolicy(pending);
 */
export function vaultEditConfirmation(
    config: VaultConfig,
    confirmed: Record<VaultEditPermission, boolean>,
): VaultEditPermission | undefined {

    return VAULT_EDIT_PERMISSIONS.find((permission) =>
        !confirmed[permission] && checkConfigPolicy('user', config, permission).requiresConfirmation);

}

/**
 * What a refused role sees instead of the edit form.
 *
 * @example
 * if (denied) return <VaultEditRefused title="Set Vault Secret" reason={denied.blockedReason} />;
 */
export function VaultEditRefused({ title, reason }: { title: string; reason?: string }): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={title} paddingX={2} paddingY={1} borderColor="yellow">
                <Text color="yellow">{reason}</Text>
            </Panel>
            <Box flexWrap="wrap" columnGap={2}>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
