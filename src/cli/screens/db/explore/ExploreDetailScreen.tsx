/**
 * ExploreDetailScreen - detailed view of a database object.
 *
 * Shows full details for tables, views, procedures, functions, and types.
 * Displays columns, indexes, foreign keys, parameters, etc.
 *
 * Keyboard shortcuts:
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm db         # Then press 'e' > '1' > select a table
 * ```
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { ScreenProps } from '../../../types.js';

import { useRouter } from '../../../router.js';
import { useFocusScope } from '../../../focus.js';
import { useAppContext } from '../../../app-context.js';
import { Panel, Spinner } from '../../../components/index.js';
import { createConnection } from '../../../../core/connection/index.js';
import { fetchDetail } from '../../../../core/explore/index.js';

import type { DetailCategory } from '../../../../core/explore/index.js';
import type {
    TableDetail,
    ViewDetail,
    ProcedureDetail,
    FunctionDetail,
    TypeDetail,
    ColumnDetail,
    ParameterDetail,
    IndexSummary,
    ForeignKeySummary,
} from '../../../../core/explore/index.js';

/**
 * Route to category mapping.
 */
const ROUTE_TO_CATEGORY: Record<string, DetailCategory> = {
    'db/explore/tables/detail': 'tables',
    'db/explore/views/detail': 'views',
    'db/explore/procedures/detail': 'procedures',
    'db/explore/functions/detail': 'functions',
    'db/explore/types/detail': 'types',
};

/**
 * Union type for all detail types.
 */
type AnyDetail = TableDetail | ViewDetail | ProcedureDetail | FunctionDetail | TypeDetail;

/**
 * Column list component.
 */
function ColumnList({ columns }: { columns: ColumnDetail[] }): ReactElement {

    if (columns.length === 0) {

        return <Text dimColor>No columns</Text>;

    }

    return (
        <Box flexDirection="column">
            {columns.map((col) => (
                <Box key={col.name} gap={2}>
                    <Box width={24}>
                        <Text color={col.isPrimaryKey ? 'yellow' : undefined}>
                            {col.isPrimaryKey ? '* ' : '  '}
                            {col.name}
                        </Text>
                    </Box>
                    <Box width={20}>
                        <Text dimColor>{col.dataType}</Text>
                    </Box>
                    <Text dimColor>
                        {col.isNullable ? 'NULL' : 'NOT NULL'}
                        {col.defaultValue ? ` DEFAULT ${col.defaultValue}` : ''}
                    </Text>
                </Box>
            ))}
        </Box>
    );

}

/**
 * Parameter list component.
 */
function ParameterList({ parameters }: { parameters: ParameterDetail[] }): ReactElement {

    if (parameters.length === 0) {

        return <Text dimColor>No parameters</Text>;

    }

    return (
        <Box flexDirection="column">
            {parameters.map((param) => (
                <Box key={param.name} gap={2}>
                    <Box width={20}>
                        <Text>{param.name}</Text>
                    </Box>
                    <Box width={16}>
                        <Text dimColor>{param.dataType}</Text>
                    </Box>
                    <Text dimColor>{param.mode}</Text>
                </Box>
            ))}
        </Box>
    );

}

/**
 * Index list component.
 */
function IndexList({ indexes }: { indexes: IndexSummary[] }): ReactElement {

    if (indexes.length === 0) {

        return <Text dimColor>No indexes</Text>;

    }

    return (
        <Box flexDirection="column">
            {indexes.map((idx) => (
                <Box key={idx.name} gap={2}>
                    <Box width={30}>
                        <Text color={idx.isPrimary ? 'yellow' : undefined}>
                            {idx.isPrimary ? '* ' : '  '}
                            {idx.name}
                        </Text>
                    </Box>
                    <Text dimColor>
                        ({idx.columns.join(', ')})
                        {idx.isUnique && !idx.isPrimary ? ' UNIQUE' : ''}
                    </Text>
                </Box>
            ))}
        </Box>
    );

}

/**
 * Foreign key list component.
 */
function ForeignKeyList({ foreignKeys }: { foreignKeys: ForeignKeySummary[] }): ReactElement {

    if (foreignKeys.length === 0) {

        return <Text dimColor>No foreign keys</Text>;

    }

    return (
        <Box flexDirection="column">
            {foreignKeys.map((fk) => (
                <Box key={fk.name} flexDirection="column">
                    <Text>{fk.name}</Text>
                    <Text dimColor>
                        {'  '}({fk.columns.join(', ')}) → {fk.referencedTable}({fk.referencedColumns.join(', ')})
                    </Text>
                </Box>
            ))}
        </Box>
    );

}

/**
 * Table detail view.
 */
function TableDetailView({ detail }: { detail: TableDetail }): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Box gap={2}>
                <Text bold>{detail.schema ? `${detail.schema}.` : ''}{detail.name}</Text>
                {detail.rowCountEstimate !== undefined && (
                    <Text dimColor>~{detail.rowCountEstimate.toLocaleString()} rows</Text>
                )}
            </Box>

            {/* Columns */}
            <Box flexDirection="column">
                <Text bold underline>Columns ({detail.columns.length})</Text>
                <ColumnList columns={detail.columns} />
            </Box>

            {/* Indexes */}
            {detail.indexes.length > 0 && (
                <Box flexDirection="column">
                    <Text bold underline>Indexes ({detail.indexes.length})</Text>
                    <IndexList indexes={detail.indexes} />
                </Box>
            )}

            {/* Foreign Keys */}
            {detail.foreignKeys.length > 0 && (
                <Box flexDirection="column">
                    <Text bold underline>Foreign Keys ({detail.foreignKeys.length})</Text>
                    <ForeignKeyList foreignKeys={detail.foreignKeys} />
                </Box>
            )}
        </Box>
    );

}

/**
 * View detail view.
 */
function ViewDetailView({ detail }: { detail: ViewDetail }): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Box gap={2}>
                <Text bold>{detail.schema ? `${detail.schema}.` : ''}{detail.name}</Text>
                <Text dimColor>{detail.isUpdatable ? 'UPDATABLE' : 'READ-ONLY'}</Text>
            </Box>

            {/* Columns */}
            <Box flexDirection="column">
                <Text bold underline>Columns ({detail.columns.length})</Text>
                <ColumnList columns={detail.columns} />
            </Box>

            {/* Definition */}
            {detail.definition && (
                <Box flexDirection="column">
                    <Text bold underline>Definition</Text>
                    <Text dimColor>{detail.definition.slice(0, 500)}{detail.definition.length > 500 ? '...' : ''}</Text>
                </Box>
            )}
        </Box>
    );

}

/**
 * Procedure detail view.
 */
function ProcedureDetailView({ detail }: { detail: ProcedureDetail }): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Text bold>{detail.schema ? `${detail.schema}.` : ''}{detail.name}</Text>

            {/* Parameters */}
            <Box flexDirection="column">
                <Text bold underline>Parameters ({detail.parameters.length})</Text>
                <ParameterList parameters={detail.parameters} />
            </Box>

            {/* Definition */}
            {detail.definition && (
                <Box flexDirection="column">
                    <Text bold underline>Definition</Text>
                    <Text dimColor>{detail.definition.slice(0, 500)}{detail.definition.length > 500 ? '...' : ''}</Text>
                </Box>
            )}
        </Box>
    );

}

/**
 * Function detail view.
 */
function FunctionDetailView({ detail }: { detail: FunctionDetail }): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Box gap={2}>
                <Text bold>{detail.schema ? `${detail.schema}.` : ''}{detail.name}</Text>
                <Text dimColor>→ {detail.returnType}</Text>
            </Box>

            {/* Parameters */}
            <Box flexDirection="column">
                <Text bold underline>Parameters ({detail.parameters.length})</Text>
                <ParameterList parameters={detail.parameters} />
            </Box>

            {/* Definition */}
            {detail.definition && (
                <Box flexDirection="column">
                    <Text bold underline>Definition</Text>
                    <Text dimColor>{detail.definition.slice(0, 500)}{detail.definition.length > 500 ? '...' : ''}</Text>
                </Box>
            )}
        </Box>
    );

}

/**
 * Type detail view.
 */
function TypeDetailView({ detail }: { detail: TypeDetail }): ReactElement {

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <Box gap={2}>
                <Text bold>{detail.schema ? `${detail.schema}.` : ''}{detail.name}</Text>
                <Text dimColor>{detail.kind.toUpperCase()}</Text>
            </Box>

            {/* Enum values */}
            {detail.kind === 'enum' && detail.values && (
                <Box flexDirection="column">
                    <Text bold underline>Values ({detail.values.length})</Text>
                    <Box flexDirection="column">
                        {detail.values.map((value, i) => (
                            <Text key={i}>  {value}</Text>
                        ))}
                    </Box>
                </Box>
            )}

            {/* Composite attributes */}
            {detail.kind === 'composite' && detail.attributes && (
                <Box flexDirection="column">
                    <Text bold underline>Attributes ({detail.attributes.length})</Text>
                    <ColumnList columns={detail.attributes} />
                </Box>
            )}

            {/* Domain base type */}
            {detail.kind === 'domain' && detail.baseType && (
                <Box flexDirection="column">
                    <Text bold underline>Base Type</Text>
                    <Text>  {detail.baseType}</Text>
                </Box>
            )}
        </Box>
    );

}

/**
 * ExploreDetailScreen component.
 *
 * Shows full details for a selected database object.
 */
export function ExploreDetailScreen({ params }: ScreenProps): ReactElement {

    const { back, route } = useRouter();
    const { isFocused } = useFocusScope('ExploreDetail');
    const { activeConfig, activeConfigName } = useAppContext();

    const [detail, setDetail] = useState<AnyDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Get category from route
    const category = ROUTE_TO_CATEGORY[route];
    const name = params.name;
    const schema = params.schema;

    // Load detail
    useEffect(() => {

        if (!activeConfig || !category || !name) {

            setIsLoading(false);

            return;

        }

        let cancelled = false;

        const load = async () => {

            setIsLoading(true);
            setError(null);

            const [result, err] = await attempt(async () => {

                const conn = await createConnection(
                    activeConfig.connection,
                    activeConfigName ?? '__explore__',
                );

                const data = await fetchDetail(
                    conn.db,
                    activeConfig.connection.dialect,
                    category,
                    name,
                    schema,
                );

                await conn.destroy();

                return data;

            });

            if (cancelled) return;

            if (err) {

                setError(err.message);

            }
            else if (!result) {

                setError(`${name} not found`);

            }
            else {

                setDetail(result as AnyDetail);

            }

            setIsLoading(false);

        };

        load();

        return () => {

            cancelled = true;

        };

    }, [activeConfig, activeConfigName, category, name, schema]);

    // Handle escape
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

        }

    });

    // Get title based on category
    const getTitle = () => {

        switch (category) {

        case 'tables': return 'Table';
        case 'views': return 'View';
        case 'procedures': return 'Procedure';
        case 'functions': return 'Function';
        case 'types': return 'Type';
        default: return 'Detail';

        }

    };

    // Missing params
    if (!name) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Error" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">Missing object name</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={getTitle()} borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={getTitle()} paddingX={1} paddingY={1}>
                    <Spinner label={`Loading ${name}...`} />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error || !detail) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={getTitle()} borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error</Text>
                        <Text dimColor>{error ?? 'Object not found'}</Text>
                    </Box>
                </Panel>

                <Box gap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Render detail based on category
    const renderDetail = () => {

        switch (category) {

        case 'tables':
            return <TableDetailView detail={detail as TableDetail} />;

        case 'views':
            return <ViewDetailView detail={detail as ViewDetail} />;

        case 'procedures':
            return <ProcedureDetailView detail={detail as ProcedureDetail} />;

        case 'functions':
            return <FunctionDetailView detail={detail as FunctionDetail} />;

        case 'types':
            return <TypeDetailView detail={detail as TypeDetail} />;

        default:
            return <Text>Unknown category</Text>;

        }

    };

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={getTitle()} paddingX={1} paddingY={1}>
                {renderDetail()}
            </Panel>

            <Box gap={2}>
                <Text dimColor>[Esc] Back</Text>
            </Box>
        </Box>
    );

}
