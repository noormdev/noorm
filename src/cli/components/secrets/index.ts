/**
 * Secret components.
 *
 * Shared components for managing secrets across different contexts:
 * - Definitions: schema/requirements stored in settings (settings/secrets/*)
 * - Values: actual secret data stored per config (secret/*)
 */

// Definition components (for settings)
export { SecretDefinitionForm } from './SecretDefinitionForm.js';
export type { SecretDefinitionFormProps } from './SecretDefinitionForm.js';

export { SecretDefinitionList, SecretDefinitionListHelp } from './SecretDefinitionList.js';
export type { SecretDefinitionListProps } from './SecretDefinitionList.js';

// Value components (for actual secrets)
export { SecretValueForm } from './SecretValueForm.js';
export type { SecretValueFormProps } from './SecretValueForm.js';

export { SecretValueList, SecretValueListHelp } from './SecretValueList.js';
export type { SecretValueListProps } from './SecretValueList.js';

// Types and utilities
export type { StageSecret, SecretType, SecretValueItem, SecretValueSummary } from './types.js';

export {
    SECRET_TYPE_OPTIONS,
    SECRET_KEY_PATTERN,
    validateSecretKey,
    checkDuplicateKey,
} from './types.js';
