import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
    CLIENT_CAPABILITIES_META_KEY,
    CLIENT_INFO_META_KEY,
    createRequestStateCodec,
    inputRequired,
    MissingRequiredClientCapabilityError,
    type InputRequiredResult,
    type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

import {
    getConfigPermission,
    getPolicyFingerprint,
    withPolicyConfirmation,
    type Permission,
} from '../core/policy/index.js';
import type { Context } from '../sdk/context.js';
import { connectionSecrets, secretRedactor, type PreparedCommand } from './prepared.js';

const approvalStateSchema = z.object({ nonce: z.string().uuid(), request: z.string() }).strict();
const approvalResponseSchema = z.object({
    action: z.literal('accept'),
    content: z.object({ approve: z.literal(true) }),
});
const approvalLifetimeMs = 5 * 60 * 1000;

/** Stable encoding for request/config hashes, independent of JSON object key order. */
export function canonicalJson(value: unknown): string {

    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {

        return `{${Object.entries(value).filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;

    }

    return JSON.stringify(value) ?? 'null';

}

function digest(value: unknown): string {

    return createHash('sha256').update(canonicalJson(value)).digest('hex');

}

interface PendingApproval {
    request: string;
    target: string;
    expires: number;
    permissions: readonly Permission[];
    prepared: PreparedCommand;
    challenge: InputRequiredResult;
}

/** Process-local one-use approvals. Wire state contains no SQL, credentials, or grants. */
export class ApprovalManager {

    #pending = new Map<string, PendingApproval>();
    #codec = createRequestStateCodec({
        key: randomBytes(32),
        ttlSeconds: approvalLifetimeMs / 1000,
        bind: (ctx) => canonicalJson([
            ctx.mcpReq.method,
            z.record(z.string(), z.unknown()).parse(ctx.mcpReq.envelope ?? {})[CLIENT_INFO_META_KEY],
        ]),
    });

    /** Installed at the SDK boundary; malformed or modified state never reaches a handler. */
    verify = async (state: string, request: ServerContext): Promise<z.infer<typeof approvalStateSchema>> => {

        return approvalStateSchema.parse(await this.#codec.verify(state, request));

    };

    async run<T>(
        ctx: Context,
        request: ServerContext,
        operation: unknown,
        permissions: readonly Permission[],
        prepare: () => Promise<PreparedCommand>,
        action: () => Promise<T>,
    ): Promise<T | InputRequiredResult> {

        const config = ctx.noorm.config;
        const requestHash = digest([request.mcpReq.method, operation]);
        const targetHash = digest([config, getPolicyFingerprint(config)]);
        const state = request.mcpReq.requestState();

        if (request.mcpReq.signal.aborted) throw new Error('Request cancelled');
        this.#expire();

        if (state !== undefined) {

            const token = approvalStateSchema.parse(state);
            const pending = this.#pending.get(token.nonce);

            if (!pending || pending.request !== requestHash || token.request !== requestHash
                || pending.target !== targetHash) {

                throw new Error('Approval is expired, already used, or does not match this operation and policy');

            }

            this.#check(config, pending.permissions);
            if (request.mcpReq.inputResponses === undefined) return pending.challenge;
            this.#pending.delete(token.nonce);
            if (!approvalResponseSchema.safeParse(request.mcpReq.inputResponses?.['approval']).success) {

                throw new Error('Operation not approved by the user');

            }

            if (request.mcpReq.signal.aborted) throw new Error('Request cancelled');

            return withPolicyConfirmation(config, pending.permissions, () => pending.prepared.run(action));

        }

        if (request.mcpReq.inputResponses !== undefined) throw new Error('Approval response has no matching requestState');
        const needsConfirmation = this.#check(config, permissions);
        if (!needsConfirmation) return action();

        const envelope = z.record(z.string(), z.unknown()).parse(request.mcpReq.envelope ?? {});
        const capabilities = z.object({
            elicitation: z.object({ form: z.object({}).optional(), url: z.object({}).optional() }),
        }).safeParse(envelope[CLIENT_CAPABILITIES_META_KEY]);
        if (!capabilities.success || (capabilities.data.elicitation.form === undefined
            && capabilities.data.elicitation.url !== undefined)) {

            throw new MissingRequiredClientCapabilityError({ requiredCapabilities: { elicitation: { form: {} } } });

        }

        const prepared = await prepare();
        const nonce = randomUUID();
        const wireState = await this.#codec.mint({ nonce, request: requestHash }, request);
        const redact = secretRedactor(connectionSecrets(config.connection));
        const heading = `Approve operation on config "${config.name}" (database "${config.connection.database}")?\nPermissions: ${permissions.join(', ')}`;
        const challenge = inputRequired({
            requestState: wireState,
            inputRequests: {
                approval: inputRequired.elicit({
                    mode: 'form',
                    message: `${redact(heading)}\n\n${prepared.summary}`,
                    requestedSchema: {
                        type: 'object',
                        properties: { approve: { type: 'boolean', title: 'Approve this exact operation', default: false } },
                        required: ['approve'],
                    },
                }),
            },
        });
        this.#pending.set(nonce, {
            request: requestHash,
            target: targetHash,
            expires: Date.now() + approvalLifetimeMs,
            permissions,
            prepared,
            challenge,
        });

        return challenge;

    }

    #check(config: Context['noorm']['config'], permissions: readonly Permission[]): boolean {

        let confirm = false;
        for (const permission of permissions) {

            const cell = getConfigPermission('agent', config, permission);
            if (cell === 'deny') throw new Error(`"${permission}" is not allowed on config "${config.name}"`);
            confirm ||= cell === 'confirm';

        }

        return confirm;

    }

    #expire(): void {

        const now = Date.now();
        for (const [nonce, approval] of this.#pending) {

            if (approval.expires <= now) this.#pending.delete(nonce);

        }

    }

}
