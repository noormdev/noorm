/**
 * Templates namespace — SQL template rendering.
 *
 * Renders Eta templates without executing. No connection required.
 */
import path from 'node:path';

import type { ProcessResult as TemplateResult } from '../../core/template/index.js';
import { processFile } from '../../core/template/index.js';
import { getStateManager } from '../../core/state/index.js';

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
     * @example
     * ```typescript
     * const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl')
     * ```
     */
    async render(filepath: string): Promise<TemplateResult> {

        const absolutePath = path.isAbsolute(filepath)
            ? filepath
            : path.join(this.#state.projectRoot, filepath);

        const state = getStateManager(this.#state.projectRoot);

        return processFile(absolutePath, {
            projectRoot: this.#state.projectRoot,
            config: this.#state.config as unknown as Record<string, unknown>,
            secrets: state.getAllSecrets(this.#state.config.name),
            globalSecrets: state.getAllGlobalSecrets(),
        });

    }

}
