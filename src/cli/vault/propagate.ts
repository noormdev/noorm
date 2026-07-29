/**
 * noorm vault propagate — propagate vault access to new users.
 */
import { defineCommand } from 'citty';

import { withVaultContext, sharedArgs, isYesMode } from '../_utils.js';
import {
    getVaultKeyChecked,
    propagateVaultKeyChecked,
    getUsersWithoutVaultAccess,
    checkVaultPolicy,
} from '../../core/vault/index.js';
import type { PendingVaultUser, VaultPolicyGate } from '../../core/vault/index.js';

/**
 * Shape of a pending identity as reported to the operator.
 *
 * Propagation seals the vault key to a public key and cannot be revoked, so
 * the operator is shown who they are granting to — name, email, hash —
 * *before* the grant, not a list of hashes afterwards.
 */
interface PendingReport {
    identityHash: string;
    name: string;
    email: string;
}

function toReport(users: PendingVaultUser[]): PendingReport[] {

    return users.map((u) => ({ identityHash: u.identityHash, name: u.name, email: u.email }));

}

const propagateCommand = defineCommand({
    meta: {
        name: 'propagate',
        description: 'Propagate vault access to new users',
    },
    args: {
        to: {
            type: 'string',
            description: 'Only propagate to these identity hashes (comma-separated)',
        },
        config: sharedArgs.config,
        json: sharedArgs.json,
        yes: sharedArgs.yes,
    },
    async run({ args }) {

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity, privateKey }) => {

                const db = ctx.kysely;
                const config = ctx.noorm.config;
                const gate: VaultPolicyGate = {
                    configName: config.name,
                    access: config.access,
                    channel: 'user',
                };

                const check = checkVaultPolicy(gate, 'vault:propagate');

                if (!check.allowed) {

                    return {
                        success: false,
                        error: check.blockedReason ?? `Cannot propagate vault access on config "${config.name}".`,
                    };

                }

                const vaultKey = await getVaultKeyChecked(gate, db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

                if (!vaultKey) {

                    return {
                        success: false,
                        error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                    };

                }

                const [pending, pendingErr] = await getUsersWithoutVaultAccess(db, ctx.dialect);

                if (pendingErr) {

                    return {
                        success: false,
                        error: `Failed to read identities awaiting vault access: ${pendingErr.message}`,
                    };

                }

                const requested = args.to
                    ? String(args.to).split(',').map((h) => h.trim()).filter(Boolean)
                    : null;

                const targets = requested
                    ? pending.filter((u) => requested.includes(u.identityHash))
                    : pending;

                if (requested) {

                    const unknown = requested.filter((h) => !pending.some((u) => u.identityHash === h));

                    if (unknown.length > 0) {

                        return {
                            success: false,
                            error: `Not awaiting vault access: ${unknown.join(', ')}`,
                        };

                    }

                }

                if (targets.length === 0) {

                    return {
                        success: true,
                        propagatedTo: [] as string[],
                        pending: [] as PendingReport[],
                        granted: false,
                        message: 'All users already have vault access',
                    };

                }

                // Withhold the grant until the operator has seen the list.
                // `vault:propagate` is a `confirm` cell for every role that
                // holds it, so this is the policy's own requirement, not an
                // extra gate invented here.
                if (!isYesMode(args)) {

                    return {
                        success: false,
                        granted: false,
                        pending: toReport(targets),
                        error: `${targets.length} identit${targets.length === 1 ? 'y is' : 'ies are'} awaiting vault access. `
                            + 'Review the list above, then re-run with --yes to grant, '
                            + 'or --to <hash> to grant to specific identities.',
                    };

                }

                const propagateResult = await propagateVaultKeyChecked(
                    gate,
                    db,
                    vaultKey,
                    ctx.dialect,
                    { targets: targets.map((u) => u.identityHash) },
                );

                // A partial grant is a failure: the teammate whose update did
                // not land believes they have access and does not.
                if (propagateResult.failed.length > 0) {

                    return {
                        success: false,
                        granted: true,
                        propagatedTo: propagateResult.propagatedTo,
                        alreadyHadAccess: propagateResult.alreadyHadAccess,
                        failed: propagateResult.failed,
                        pending: toReport(targets),
                        error: `Failed to grant vault access to ${propagateResult.failed.length} of ${targets.length} identities.`,
                    };

                }

                return {
                    success: true,
                    granted: true,
                    propagatedTo: propagateResult.propagatedTo,
                    alreadyHadAccess: propagateResult.alreadyHadAccess,
                    failed: propagateResult.failed,
                    pending: toReport(targets),
                };

            },
        });

        if (err) {

            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify(result) + '\n');

        }
        else if (result?.success) {

            const propagated = result.propagatedTo ?? [];

            if (propagated.length === 0) {

                process.stdout.write(`${result.message ?? 'All users already have vault access'}\n`);

            }
            else {

                const byHash = new Map((result.pending ?? []).map((p) => [p.identityHash, p]));

                process.stdout.write(`Granted vault access to ${propagated.length} identities\n`);

                for (const hash of propagated) {

                    const who = byHash.get(hash);

                    process.stdout.write(who ? `  ${who.name} <${who.email}>  ${hash}\n` : `  ${hash}\n`);

                }

            }

        }
        else {

            for (const who of result?.pending ?? []) {

                process.stderr.write(`  ${who.name} <${who.email}>  ${who.identityHash}\n`);

            }

            for (const failure of result?.failed ?? []) {

                process.stderr.write(`  FAILED ${failure.email}  ${failure.identityHash}: ${failure.error}\n`);

            }

            process.stderr.write(`Error: ${result?.error ?? 'Unknown error'}\n`);

        }

        process.exit(result?.success ? 0 : 1);

    },
});

(propagateCommand as typeof propagateCommand & { examples: string[] }).examples = [
    'noorm vault propagate',
    'noorm vault propagate --yes',
    'noorm vault propagate --to 4a5c14af... --yes',
    'noorm vault propagate --json',
];

export default propagateCommand;
