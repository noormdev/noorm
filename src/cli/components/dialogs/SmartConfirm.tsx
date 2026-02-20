/**
 * SmartConfirm — renders ProtectedConfirm or Confirm based on protection status.
 *
 * Eliminates the repeated if/else branch pattern across screens that
 * conditionally show type-to-confirm vs simple yes/no confirmation.
 *
 * @example
 * <SmartConfirm
 *     protected={activeConfig.protected ?? false}
 *     configName={activeConfigName ?? 'config'}
 *     action="apply this change"
 *     message="Apply this change?"
 *     onConfirm={handleRun}
 *     onCancel={handleCancel}
 *     isFocused={isFocused}
 * />
 */
import type { ReactElement } from 'react';

import { Confirm } from './Confirm.js';
import { ProtectedConfirm } from './ProtectedConfirm.js';

/**
 * SmartConfirm props.
 */
export interface SmartConfirmProps {

    /** Whether the config is protected (determines which confirm to show). */
    protected: boolean;

    /** Config name for ProtectedConfirm. */
    configName: string;

    /** Action description for ProtectedConfirm (e.g. "apply this change"). */
    action: string;

    /** Message for normal Confirm (e.g. "Apply this change?"). */
    message: string;

    /** Callback when user confirms. */
    onConfirm: () => void;

    /** Callback when user cancels. */
    onCancel: () => void;

    /** Focus scope label (passed to both). */
    focusLabel?: string;

    /** External focus state (passed to both). */
    isFocused?: boolean;

    /** Confirm dialog title (only used for normal Confirm). */
    title?: string;

    /** Confirm dialog variant (only used for normal Confirm). */
    variant?: 'default' | 'danger' | 'warning';

}

/**
 * Renders ProtectedConfirm or Confirm based on protection status.
 */
export function SmartConfirm(props: SmartConfirmProps): ReactElement {

    if (props.protected) {

        return (
            <ProtectedConfirm
                configName={props.configName}
                action={props.action}
                onConfirm={props.onConfirm}
                onCancel={props.onCancel}
                focusLabel={props.focusLabel}
                isFocused={props.isFocused}
            />
        );

    }

    return (
        <Confirm
            message={props.message}
            onConfirm={props.onConfirm}
            onCancel={props.onCancel}
            focusLabel={props.focusLabel}
            isFocused={props.isFocused}
            title={props.title}
            variant={props.variant}
        />
    );

}
