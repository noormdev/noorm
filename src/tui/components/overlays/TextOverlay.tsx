/**
 * TextOverlay - a scrollable view of one block of text, at full length.
 *
 * Screens that list operations have to summarise: a history row is one line, and
 * the detail box under it has a handful. A stack trace fits neither, so both
 * history screens truncated one — at 80 characters in the list, and at nothing
 * at all in the detail box, where `split('\n').map()` drew a row per line and
 * pushed the rest of the screen off the bottom. Truncating loses the part of an
 * error that says what went wrong, and not truncating loses the screen; this is
 * the third option, and the reason a screen may show a bounded preview without
 * that preview being all a reader can ever get.
 *
 * The text is wrapped here rather than by Ink, because a viewport counts rows
 * and a `<Text>` left to wrap itself occupies however many the terminal decides.
 *
 * Focus follows the overlay pattern `LogViewerOverlay` established: its own
 * `useFocusScope`, and Escape as the only way out.
 *
 * @example
 * {showError && <TextOverlay title="Error" text={record.errorMessage} onClose={close} />}
 */
import { Box, Text, useWindowSize, useInput } from 'ink';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../focus.js';
import { ScrollPane, rowBudget, wrapText } from '../terminal/index.js';

/**
 * Props for the text overlay.
 */
export interface TextOverlayProps {

    /** Names what is being shown, since the overlay covers the screen that has the context. */
    title: string;

    /** The text, at full length. Newlines are honoured; long lines are wrapped, not cut. */
    text: string;

    /** Called when the reader dismisses the overlay. */
    onClose: () => void;

}

/** The title line, its rule, and the hint line under the body. */
const CHROME_ROWS = 3;

/** Rows the app shell and this overlay's own border spend before any text is drawn. */
const SHELL_ROWS = 8;

/**
 * TextOverlay component.
 */
export function TextOverlay({ title, text, onClose }: TextOverlayProps): ReactElement {

    const { isFocused } = useFocusScope('TextOverlay');
    const { columns, rows } = useWindowSize();

    const width = rowBudget(columns);
    const height = Math.max(rows - SHELL_ROWS - CHROME_ROWS, 3);

    const lines = wrapText(text, width).map((line, index) => (
        <Text key={`line:${index}`} wrap="truncate">{line}</Text>
    ));

    // Escape only. Every other key belongs to the ScrollPane below, which reads
    // the same focus value and so is live exactly while this is.
    useInput((_input, key) => {

        if (!isFocused) return;

        if (key.escape) onClose();

    });

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
            <Text bold color="red">{title}</Text>
            <Text dimColor>{'─'.repeat(width)}</Text>
            <ScrollPane lines={lines} height={height} isFocused={isFocused} />
            <Text dimColor>[↑↓] Scroll  [Ctrl+U/D] Page  [Esc] Back</Text>
        </Box>
    );

}
