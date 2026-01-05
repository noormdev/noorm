/**
 * Core module exports.
 *
 * All business logic modules are exported from here.
 * CLI components should import from this barrel file.
 */

// Observer
export { observer } from './observer.js';
export type { NoormEvents, ObserverEngine } from './observer.js';

// State
export {
    StateManager,
    getStateManager,
    initState,
    resetStateManager,
    createEmptyState,
    migrateState,
    needsMigration,
    getPackageVersion,
} from './state/index.js';
export type { State, ConfigSummary, EncryptedPayload } from './state/index.js';

// Config types (ConfigSummary is exported via state/index.js)
export type { Config, ConfigInput } from './config/types.js';

// Connection
export {
    createConnection,
    testConnection,
    getConnectionManager,
    resetConnectionManager,
} from './connection/index.js';
export type { Dialect, ConnectionConfig, ConnectionResult } from './connection/index.js';

// Settings
export {
    SettingsManager,
    getSettingsManager,
    resetSettingsManager,
    SettingsValidationError,
    validateSettings,
    parseSettings,
    ruleMatches,
    evaluateRule,
    evaluateRules,
    getEffectiveBuildPaths,
    DEFAULT_SETTINGS,
    SETTINGS_FILE_PATH,
} from './settings/index.js';
export type {
    Settings,
    Stage,
    StageSecret,
    StageDefaults,
    Rule,
    RuleMatch,
    BuildConfig,
    PathConfig,
    StrictConfig,
    LoggingConfig,
    TeardownConfig,
    RulesEvaluationResult,
    ConfigForRuleMatch,
    SettingsManagerOptions,
} from './settings/index.js';

// Lifecycle
export {
    LifecycleManager,
    getLifecycleManager,
    resetLifecycleManager,
    registerSignalHandlers,
    registerExceptionHandlers,
    removeAllHandlers,
    hasSignalHandlers,
    hasExceptionHandlers,
    DEFAULT_TIMEOUTS,
    createDefaultConfig,
} from './lifecycle/index.js';
export type {
    LifecycleState,
    ShutdownPhase,
    PhaseStatus,
    ShutdownReason,
    AppMode,
    ShutdownTimeouts,
    LifecycleConfig,
    ShutdownPhaseInfo,
    LifecycleResource,
    LifecycleManagerState,
    Signal,
    SignalCallback,
    ErrorCallback,
    CleanupFn,
} from './lifecycle/index.js';

// Shared (table types, constants, and utilities)
export { NOORM_TABLES, filterFilesByPaths, matchesPathPrefix } from './shared/index.js';
export type {
    NoormTableName,
    NoormDatabase,
    // Version table
    NoormVersionTable,
    NoormVersion,
    NewNoormVersion,
    NoormVersionUpdate,
    // Change table
    NoormChangeTable,
    NoormChange,
    NewNoormChange,
    NoormChangeUpdate,
    OperationStatus,
    ChangeType,
    Direction,
    // Executions table
    NoormExecutionsTable,
    NoormExecution,
    NewNoormExecution,
    NoormExecutionUpdate,
    ExecutionStatus,
    FileType,
    // Lock table
    NoormLockTable,
    NoormLock,
    NewNoormLock,
    NoormLockUpdate,
    // Identities table
    NoormIdentitiesTable,
    NoormIdentity,
    NewNoormIdentity,
    NoormIdentityUpdate,
} from './shared/index.js';

// Version
export {
    VersionManager,
    getVersionManager,
    resetVersionManager,
    CURRENT_VERSIONS,
    VersionMismatchError,
    MigrationError,
    // Schema
    checkSchemaVersion,
    migrateSchema,
    ensureSchemaVersion,
    bootstrapSchema,
    tablesExist,
    getSchemaVersion,
    updateVersionRecord,
    getLatestVersionRecord,
    // State
    checkStateVersion,
    migrateState as migrateStateVersion,
    ensureStateVersion,
    needsStateMigration,
    createEmptyVersionedState,
    getStateVersion,
    // Settings
    checkSettingsVersion,
    migrateSettings as migrateSettingsVersion,
    ensureSettingsVersion,
    needsSettingsMigration,
    createEmptyVersionedSettings,
    getSettingsVersion,
} from './version/index.js';
export type {
    VersionLayer,
    VersionStatus,
    LayerVersionStatus,
    SchemaMigration,
    StateMigration,
    SettingsMigration,
    VersionRecordOptions,
} from './version/index.js';

// Lock
export {
    LockManager,
    getLockManager,
    resetLockManager,
    LockAcquireError,
    LockExpiredError,
    LockNotFoundError,
    LockOwnershipError,
    DEFAULT_LOCK_OPTIONS,
} from './lock/index.js';
export type { Lock, LockOptions, LockStatus } from './lock/index.js';

// Template
export {
    processFile,
    processFiles,
    renderTemplate,
    isTemplate,
    buildContext,
    loadHelpers,
    findHelperFiles,
    loadDataFile,
    hasLoader,
    getLoader,
    getSupportedExtensions,
    loadJson5,
    loadYaml,
    loadCsv,
    loadJs,
    loadSql,
    toContextKey,
    sqlEscape,
    sqlQuote,
    generateUuid,
    isoNow,
    eta,
    DATA_EXTENSIONS,
    TEMPLATE_EXTENSION,
    HELPER_FILENAME,
    HELPER_EXTENSIONS,
} from './template/index.js';
export type {
    TemplateContext,
    BuiltInHelpers,
    RenderOptions,
    ProcessResult,
    LoaderResult,
    Loader,
    LoaderRegistry,
} from './template/index.js';

// Runner
export {
    runBuild,
    runFile,
    runDir,
    preview,
    discoverFiles,
    Tracker,
    computeChecksum,
    computeChecksumFromContent,
    computeCombinedChecksum,
    DEFAULT_RUN_OPTIONS,
} from './runner/index.js';
export type {
    RunOptions,
    RunContext,
    FileResult,
    BatchResult,
    BatchStatus,
    SkipReason,
    RunReason,
    NeedsRunResult,
    CreateOperationData,
    RecordExecutionData,
} from './runner/index.js';

// Database lifecycle
export { checkDbStatus, createDb, destroyDb, getDialectOperations } from './db/index.js';
export type { DbStatus, DbOperationResult, CreateDbOptions, DestroyDbOptions } from './db/index.js';

// Teardown (database reset/wipe)
export {
    truncateData,
    teardownSchema,
    previewTeardown,
    getTeardownOperations,
} from './teardown/index.js';
export type {
    TruncateOptions,
    TruncateResult,
    TeardownOptions,
    TeardownResult,
    TeardownPreview,
    TeardownDialectOperations,
} from './teardown/index.js';

// Change
export {
    // Manager
    ChangeManager,
    // History
    ChangeHistory,
    // Executor
    executeChange,
    revertChange,
    // Parser
    parseChange,
    discoverChanges,
    resolveManifest,
    validateChange,
    hasRevertFiles,
    parseSequence,
    parseDescription,
    // Scaffold
    createChange,
    addFile,
    removeFile,
    renameFile,
    reorderFiles,
    deleteChange,
    // Defaults
    DEFAULT_CHANGE_OPTIONS,
    DEFAULT_BATCH_OPTIONS,
    // Errors
    ChangeValidationError,
    ChangeNotFoundError,
    ChangeAlreadyAppliedError,
    ChangeNotAppliedError,
    ChangeOrphanedError,
    ManifestReferenceError,
} from './change/index.js';
export type {
    // File types
    ChangeFileType,
    ChangeFile,
    // Change types
    Change,
    ChangeStatus,
    ChangeListItem,
    // Options
    ChangeOptions,
    BatchChangeOptions,
    ChangeContext,
    // Results
    ChangeResult,
    ChangeFileResult,
    BatchChangeResult,
    // History
    ChangeHistoryRecord,
    FileHistoryRecord,
    // Change detection
    ChangeRunReason,
    NeedsRunResult as ChangeNeedsRunResult,
    // Scaffold
    CreateChangeOptions,
    AddFileOptions,
} from './change/index.js';

// SQL Terminal
export { SqlHistoryManager, executeRawSql } from './sql-terminal/index.js';
export type {
    SqlHistoryEntry,
    SqlExecutionResult,
    SqlHistoryFile,
    ClearResult,
} from './sql-terminal/index.js';

// Theme (Modern Slate color scheme)
export {
    palette,
    theme,
    status,
    ui,
    icons,
    box,
    borders,
    data,
    logLevelColors,
    logLevelIcons,
} from './theme.js';

// Re-export ansis for direct color usage
export { default as ansis } from 'ansis';

// Help formatter (markdown-to-colored-terminal)
export { formatHelp, stripColors } from './help-formatter.js';

// Debug (internal table inspection)
export {
    createDebugOperations,
    getTableInfo,
    getAllTableNames,
    NOORM_TABLE_INFO,
} from './debug/index.js';
export type {
    NoormTableInfo,
    TableCountResult,
    NoormTableRow,
    SortDirection,
    GetRowsOptions,
    DebugOperations,
} from './debug/index.js';

// Project discovery
export {
    findProjectRoot,
    initProjectContext,
    isNoormProject,
    getGlobalNoormPath,
    hasGlobalNoorm,
} from './project.js';
export type { ProjectDiscoveryResult } from './project.js';
