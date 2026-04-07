/**
 * React hooks for the CLI.
 */
export {
    useOnEvent,
    useOnceEvent,
    useEmit,
    useEventPromise,
    useOnScreenPopped,
    type EventPromiseState,
} from './useObserver.js';

export {
    useRunProgress,
    type RunProgressState,
    type RunPhase,
    type ProgressFileResult,
} from './useRunProgress.js';

export {
    useTransferProgress,
    type TransferProgressState,
    type TransferPhase,
    type TransferTableProgress,
} from './useTransferProgress.js';

export { useUpdateChecker, type UseUpdateCheckerResult } from './useUpdateChecker.js';

export {
    useChangeProgress,
    type ChangeProgressState,
} from './useChangeProgress.js';

export {
    useLockStatus,
    type LockStatusResult,
} from './useLockStatus.js';

export {
    useLoadGuard,
    type LoadGuard,
} from './useLoadGuard.js';

export {
    useVaultConnection,
    type VaultConnectionResult,
    type UseVaultConnectionOptions,
} from './useVaultConnection.js';

export {
    useVaultSecretKeys,
    type VaultSecretKeysResult,
} from './useVaultSecretKeys.js';

export {
    useConnection,
    type ConnectionState,
    type UseConnectionOptions,
} from './useConnection.js';

export { useAsyncEffect } from './useAsyncEffect.js';

export {
    useSettingsOperation,
    type UseSettingsOperationOptions,
} from './useSettingsOperation.js';

export {
    useSecretSource,
    type SecretSourceResult,
} from './useSecretSource.js';
