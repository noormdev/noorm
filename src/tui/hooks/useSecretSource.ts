/**
 * Hook for resolving secret source based on universal vs stage scope.
 *
 * Deduplicates the stage lookup + secret source resolution pattern
 * shared by SettingsSecretEditScreen and SettingsSecretRemoveScreen.
 *
 * @example
 * ```typescript
 * const { stageName, secretKey, source, existingSecret, existingKeys, stage } =
 *     useSecretSource(params);
 * ```
 */
import { useMemo } from 'react';

import type { StageSecret } from '../components/index.js';
import type { Stage } from '../../core/settings/types.js';

import { useAppContext } from '../app-context.js';

/**
 * Result of secret source resolution.
 */
export interface SecretSourceResult {
    stageName: string | undefined;
    secretKey: string | undefined;
    source: StageSecret[] | undefined;
    existingSecret: StageSecret | null;
    existingKeys: string[];
    stage: Stage | null;
}

/**
 * Resolve secret source from params, handling universal vs stage-specific scope.
 */
export function useSecretSource(params: { stage?: string; name?: string }): SecretSourceResult {

    const { settings } = useAppContext();

    const stageName = params.stage;
    const secretKey = params.name;

    // Get stage (only when stageName is set)
    const stage = useMemo(() => {

        if (!settings?.stages || !stageName) return null;

        return settings.stages[stageName] ?? null;

    }, [settings, stageName]);

    // Resolve secret source based on scope
    const source = stageName ? stage?.secrets : settings?.secrets;

    // Get existing secret if editing
    const existingSecret = useMemo(() => {

        if (!source || !secretKey) return null;

        return source.find((s) => s.key === secretKey) ?? null;

    }, [source, secretKey]);

    // Get all secret keys for validation
    const existingKeys = useMemo(() => {

        if (!source) return [];

        return source.map((s) => s.key);

    }, [source]);

    return { stageName, secretKey, source, existingSecret, existingKeys, stage };

}
