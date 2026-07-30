/**
 * Templates namespace — SQL template rendering.
 *
 * Renders Eta templates without executing. No connection required.
 */
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { ProcessResult as TemplateResult } from '../../core/template/index.js';
import { processFile } from '../../core/template/index.js';
import { getStateManager } from '../../core/state/index.js';
import { checkConfigPolicy } from '../../core/policy/index.js';
import type { NoormDatabase } from '../../core/shared/index.js';
import { resolveVaultKey, buildSecretsContext } from '../../core/vault/index.js';
import { ProtectedConfigError } from '../guards.js';

import type { ContextState } from '../state.js';

// ─────────────────────────────────────────────────────────────
// TemplatesNamespace
// ─────────────────────────────────────────────────────────────

export class TemplatesNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Render a template file without executing.
     *
     * "Without executing" is about the SQL: the render itself resolves
     * every secret tier into the returned string and runs the template's
     * `$helpers` and referenced side-car scripts. Gated on `run:file` to
     * match core `preview()` — `checkConfigPolicy` rather than
     * `checkProtectedConfig` because a `confirm` cell must not block a
     * read-only render the way it blocks an execution.
     *
     * @throws ProtectedConfigError when the channel's role is denied
     *
     * @example
     * ```typescript
     * const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl')
     * ```
     */
    async render(filepath: string): Promise<TemplateResult> {

        const check = checkConfigPolicy(
            this.#state.options.channel ?? 'user',
            this.#state.config,
            'run:file',
        );

        if (!check.allowed) {

            throw new ProtectedConfigError(this.#state.config.name, 'templates.render', check.blockedReason);

        }

        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

        const state = getStateManager(this.#state.projectRoot);
        const conn = this.#state.connection;
        const db = conn?.db as unknown as Kysely<NoormDatabase> | undefined;
        const vaultKey = db && conn ? await resolveVaultKey(db, conn.dialect) : null;

        return processFile(absolutePath, {
            projectRoot: this.#state.projectRoot,
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: await buildSecretsContext(state, this.#state.config.name, db, vaultKey, conn?.dialect),
            globalSecrets: state.getAllGlobalSecrets(),
        });

    }

}
