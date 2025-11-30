# Ink Cheatsheet


A comprehensive reference for building CLI applications with Ink (React for the terminal).


## Table of Contents


- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Components](#components)
- [Hooks](#hooks)
- [Ink UI Components](#ink-ui-components)
- [Meow (Argument Parsing)](#meow-argument-parsing)
- [Patterns](#patterns)
- [Tips & Gotchas](#tips--gotchas)


## Installation


```bash
npm install ink react
npm install --save-dev @types/react @types/node typescript
```

For Ink UI components:

```bash
npm install @inkjs/ui
```


## Core Concepts


### Basic App Structure

```tsx
#!/usr/bin/env node
import { render } from "ink";
import { App } from "./App.js";

render(<App />, {
    exitOnCtrlC: true,
});
```


### render() Options

```tsx
const instance = render(<App />, {
    stdout: process.stdout,      // Output stream
    stdin: process.stdin,        // Input stream
    stderr: process.stderr,      // Error stream
    exitOnCtrlC: true,           // Exit on Ctrl+C
    patchConsole: true,          // Patch console.log to work with Ink
    debug: false,                // Debug mode
});

// Instance methods
instance.unmount();              // Unmount the app
instance.clear();                // Clear the output
instance.rerender(<NewApp />);   // Re-render with new component
await instance.waitUntilExit();  // Wait for app to exit
```


### Exit Programmatically

```tsx
import { useApp } from "ink";

function App() {
    const { exit } = useApp();

    // Exit normally
    exit();

    // Exit with error (rejects waitUntilExit promise)
    exit(new Error("Something went wrong"));
}
```


## Components


### Box

The fundamental layout component. Works like a `<div>` with flexbox.

```tsx
import { Box, Text } from "ink";

// Basic usage
<Box margin={2}>
    <Text>Content</Text>
</Box>

// Flexbox layout
<Box flexDirection="column" justifyContent="center" alignItems="center">
    <Text>Centered</Text>
</Box>

// With dimensions
<Box width={50} height={10} padding={1}>
    <Text>Fixed size</Text>
</Box>

// Percentage width
<Box width="50%">
    <Text>Half width</Text>
</Box>
```


#### Box Props Reference

| Prop | Type | Description |
|------|------|-------------|
| `flexDirection` | `row` \| `column` \| `row-reverse` \| `column-reverse` | Direction of flex items |
| `flexGrow` | `number` | Grow factor |
| `flexShrink` | `number` | Shrink factor |
| `flexWrap` | `wrap` \| `nowrap` \| `wrap-reverse` | Wrap behavior |
| `justifyContent` | `flex-start` \| `flex-end` \| `center` \| `space-between` \| `space-around` | Main axis alignment |
| `alignItems` | `flex-start` \| `flex-end` \| `center` \| `stretch` | Cross axis alignment |
| `alignSelf` | `flex-start` \| `flex-end` \| `center` \| `auto` | Self alignment |
| `gap` | `number` | Gap between children |
| `rowGap` | `number` | Gap between rows |
| `columnGap` | `number` | Gap between columns |
| `width` | `number` \| `string` | Width (number or percentage) |
| `height` | `number` \| `string` | Height (number or percentage) |
| `minWidth` | `number` | Minimum width |
| `minHeight` | `number` | Minimum height |
| `padding` | `number` | Padding all sides |
| `paddingX` | `number` | Horizontal padding |
| `paddingY` | `number` | Vertical padding |
| `paddingTop` | `number` | Top padding |
| `paddingBottom` | `number` | Bottom padding |
| `paddingLeft` | `number` | Left padding |
| `paddingRight` | `number` | Right padding |
| `margin` | `number` | Margin all sides |
| `marginX` | `number` | Horizontal margin |
| `marginY` | `number` | Vertical margin |
| `marginTop` | `number` | Top margin |
| `marginBottom` | `number` | Bottom margin |
| `marginLeft` | `number` | Left margin |
| `marginRight` | `number` | Right margin |


#### Border Styles

```tsx
// Predefined styles
<Box borderStyle="single">Single</Box>
<Box borderStyle="double">Double</Box>
<Box borderStyle="round">Round</Box>
<Box borderStyle="bold">Bold</Box>
<Box borderStyle="singleDouble">Single Double</Box>
<Box borderStyle="doubleSingle">Double Single</Box>
<Box borderStyle="classic">Classic</Box>

// Border color
<Box borderStyle="round" borderColor="cyan">
    <Text>Colored border</Text>
</Box>

// Individual borders
<Box borderTop borderBottom borderLeft={false} borderRight={false}>
    <Text>Top and bottom only</Text>
</Box>

// Custom border
<Box borderStyle={{
    topLeft: "╔",
    top: "═",
    topRight: "╗",
    left: "║",
    right: "║",
    bottomLeft: "╚",
    bottom: "═",
    bottomRight: "╝"
}}>
    <Text>Custom</Text>
</Box>
```


#### Background Colors

```tsx
<Box backgroundColor="red">Red background</Box>
<Box backgroundColor="#FF8800">Hex color</Box>
<Box backgroundColor="rgb(0, 255, 0)">RGB color</Box>
```


### Text

All text must be wrapped in `<Text>` components.

```tsx
import { Text } from "ink";

// Colors
<Text color="green">Green text</Text>
<Text color="#FF5733">Hex color</Text>
<Text color="rgb(255, 87, 51)">RGB color</Text>

// Background
<Text backgroundColor="blue" color="white">White on blue</Text>

// Styles
<Text bold>Bold</Text>
<Text italic>Italic</Text>
<Text underline>Underlined</Text>
<Text strikethrough>Strikethrough</Text>
<Text dimColor>Dimmed</Text>
<Text inverse>Inverted</Text>

// Combine styles
<Text bold italic color="cyan">Bold italic cyan</Text>

// Text wrapping
<Text wrap="truncate">Long text will be truncated...</Text>
<Text wrap="truncate-middle">Truncates in the middle...</Text>
<Text wrap="truncate-end">Truncates at the end...</Text>
```


#### Text Props Reference

| Prop | Type | Description |
|------|------|-------------|
| `color` | `string` | Text color (name, hex, rgb) |
| `backgroundColor` | `string` | Background color |
| `bold` | `boolean` | Bold text |
| `italic` | `boolean` | Italic text |
| `underline` | `boolean` | Underlined text |
| `strikethrough` | `boolean` | Strikethrough text |
| `dimColor` | `boolean` | Dimmed color |
| `inverse` | `boolean` | Inverse colors |
| `wrap` | `wrap` \| `truncate` \| `truncate-middle` \| `truncate-end` | Wrap behavior |


### Newline

Insert a newline.

```tsx
import { Newline, Text } from "ink";

<Text>
    First line
    <Newline />
    Second line
</Text>

// Multiple newlines
<Text>
    Line 1
    <Newline count={2} />
    Line 4
</Text>
```


### Spacer

Fills available space (like `flex-grow: 1`).

```tsx
import { Box, Text, Spacer } from "ink";

// Horizontal spacing
<Box>
    <Text>Left</Text>
    <Spacer />
    <Text>Right</Text>
</Box>

// Vertical spacing
<Box flexDirection="column" height={10}>
    <Text>Top</Text>
    <Spacer />
    <Text>Bottom</Text>
</Box>
```


### Static

Renders content permanently (won't be updated). Perfect for logs or completed tasks.

```tsx
import { Static, Box, Text } from "ink";

function App() {
    const [logs, setLogs] = useState<string[]>([]);

    return (
        <>
            {/* Rendered once, never updated */}
            <Static items={logs}>
                {(log, index) => (
                    <Box key={index}>
                        <Text color="green">✓ {log}</Text>
                    </Box>
                )}
            </Static>

            {/* Dynamic content below */}
            <Box>
                <Text>Processing...</Text>
            </Box>
        </>
    );
}
```


### Transform

Transform text output with a function.

```tsx
import { Transform, Text } from "ink";

<Transform transform={(output) => output.toUpperCase()}>
    <Text>This will be uppercase</Text>
</Transform>
```


## Hooks


### useInput

Handle keyboard input.

```tsx
import { useInput } from "ink";

function App() {
    useInput((input, key) => {
        // Character input
        if (input === "q") {
            process.exit(0);
        }

        // Special keys
        if (key.return) {
            // Enter pressed
        }

        if (key.escape) {
            // Escape pressed
        }

        // Arrow keys
        if (key.upArrow) { }
        if (key.downArrow) { }
        if (key.leftArrow) { }
        if (key.rightArrow) { }

        // Modifiers
        if (key.ctrl && input === "c") {
            // Ctrl+C
        }

        if (key.meta) {
            // Alt/Option key held
        }

        if (key.shift) {
            // Shift key held
        }

        // Other special keys
        if (key.backspace) { }
        if (key.delete) { }
        if (key.tab) { }
        if (key.pageUp) { }
        if (key.pageDown) { }
    });
}
```


#### Key Object Reference

| Property | Type | Description |
|----------|------|-------------|
| `upArrow` | `boolean` | Up arrow pressed |
| `downArrow` | `boolean` | Down arrow pressed |
| `leftArrow` | `boolean` | Left arrow pressed |
| `rightArrow` | `boolean` | Right arrow pressed |
| `return` | `boolean` | Enter/Return pressed |
| `escape` | `boolean` | Escape pressed |
| `ctrl` | `boolean` | Ctrl held |
| `shift` | `boolean` | Shift held |
| `meta` | `boolean` | Alt/Option held |
| `tab` | `boolean` | Tab pressed |
| `backspace` | `boolean` | Backspace pressed |
| `delete` | `boolean` | Delete pressed |
| `pageUp` | `boolean` | Page Up pressed |
| `pageDown` | `boolean` | Page Down pressed |


#### Conditional Input

```tsx
// Only listen when active
useInput(
    (input, key) => { /* ... */ },
    { isActive: isFocused }
);
```


### useFocus

Make components focusable (Tab/Shift+Tab navigation).

```tsx
import { useFocus, Text } from "ink";

function FocusableItem() {
    const { isFocused } = useFocus();

    return (
        <Text color={isFocused ? "green" : "white"}>
            {isFocused ? "> " : "  "}Item
        </Text>
    );
}

// With options
function AutoFocusItem() {
    const { isFocused } = useFocus({
        autoFocus: true,  // Focus on mount
        id: "my-item",    // Unique ID for programmatic focus
    });

    return <Text>{isFocused ? "Focused" : "Not focused"}</Text>;
}
```


### useFocusManager

Programmatically control focus.

```tsx
import { useFocusManager, useInput } from "ink";

function App() {
    const {
        focusNext,      // Focus next item
        focusPrevious,  // Focus previous item
        focus,          // Focus specific ID
        enableFocus,    // Enable focus system
        disableFocus,   // Disable focus system
    } = useFocusManager();

    useInput((input, key) => {
        if (key.downArrow) focusNext();
        if (key.upArrow) focusPrevious();
        if (input === "1") focus("item-1");
    });

    return (/* ... */);
}
```


### useApp

Access app instance methods.

```tsx
import { useApp } from "ink";

function App() {
    const { exit } = useApp();

    // Exit the application
    const handleDone = () => exit();

    // Exit with error
    const handleError = () => exit(new Error("Failed"));
}
```


### useStdin

Access stdin stream.

```tsx
import { useStdin } from "ink";

function App() {
    const {
        stdin,           // stdin stream
        isRawModeSupported,  // Can use raw mode?
        setRawMode,      // Enable/disable raw mode
    } = useStdin();
}
```


### useStdout

Access stdout stream and dimensions.

```tsx
import { useStdout } from "ink";

function App() {
    const { stdout, write } = useStdout();

    // Terminal dimensions
    const { columns, rows } = stdout;

    // Write directly to stdout
    write("Direct output\n");
}
```


### useStderr

Access stderr stream.

```tsx
import { useStderr } from "ink";

function App() {
    const { stderr, write } = useStderr();

    write("Error message\n");
}
```


### measureElement

Measure rendered element dimensions.

```tsx
import { useRef, useEffect, useState } from "react";
import { measureElement, Box, Text } from "ink";

function App() {
    const ref = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (ref.current) {
            const { width, height } = measureElement(ref.current);
            setDimensions({ width, height });
        }
    }, []);

    return (
        <Box ref={ref} width="50%" padding={2}>
            <Text>Size: {dimensions.width}x{dimensions.height}</Text>
        </Box>
    );
}
```


## Ink UI Components


Install: `npm install @inkjs/ui`

```tsx
import {
    TextInput,
    PasswordInput,
    Select,
    MultiSelect,
    ConfirmInput,
    Spinner,
    ProgressBar,
    Badge,
    StatusMessage,
    Alert,
    UnorderedList,
    OrderedList,
    ThemeProvider,
} from "@inkjs/ui";
```


### TextInput

```tsx
<TextInput
    placeholder="Enter name..."
    defaultValue=""
    suggestions={["apple", "banana", "cherry"]}
    onChange={(value) => console.log(value)}
    onSubmit={(value) => console.log("Submitted:", value)}
    isDisabled={false}
/>
```


### PasswordInput

```tsx
<PasswordInput
    placeholder="Enter password..."
    onChange={(value) => setPassword(value)}
    onSubmit={(value) => handleLogin(value)}
    isDisabled={false}
/>
```


### Select

```tsx
<Select
    options={[
        { label: "Red", value: "red" },
        { label: "Green", value: "green" },
        { label: "Blue", value: "blue" },
    ]}
    defaultValue="red"
    visibleOptionCount={5}
    highlightText="re"
    onChange={(value) => setColor(value)}
    isDisabled={false}
/>
```


### MultiSelect

```tsx
<MultiSelect
    options={[
        { label: "TypeScript", value: "ts" },
        { label: "JavaScript", value: "js" },
        { label: "Python", value: "py" },
    ]}
    defaultValue={["ts"]}
    onChange={(values) => setLanguages(values)}
/>
```


### ConfirmInput

```tsx
<ConfirmInput
    defaultChoice="confirm"  // or "cancel"
    submitOnEnter={true}
    onConfirm={() => console.log("Confirmed")}
    onCancel={() => console.log("Cancelled")}
/>
```


### Spinner

```tsx
<Spinner label="Loading..." />
```


### ProgressBar

```tsx
// value: 0-100
<ProgressBar value={75} />
```


### Badge

```tsx
<Badge color="green">Pass</Badge>
<Badge color="red">Fail</Badge>
<Badge color="yellow">Warn</Badge>
<Badge color="blue">Info</Badge>
```


### StatusMessage

```tsx
<StatusMessage variant="success">Deployed successfully</StatusMessage>
<StatusMessage variant="error">Deployment failed</StatusMessage>
<StatusMessage variant="warning">Deprecated API</StatusMessage>
<StatusMessage variant="info">Update available</StatusMessage>
```


### Alert

```tsx
<Alert variant="success" title="Success">
    Your changes have been saved.
</Alert>

<Alert variant="error" title="Error">
    Failed to save changes.
</Alert>

<Alert variant="warning">
    This action cannot be undone.
</Alert>

<Alert variant="info">
    A new version is available.
</Alert>
```


### UnorderedList

```tsx
<UnorderedList>
    <UnorderedList.Item>First item</UnorderedList.Item>
    <UnorderedList.Item>Second item</UnorderedList.Item>
    <UnorderedList.Item>
        Nested list:
        <UnorderedList>
            <UnorderedList.Item>Nested item</UnorderedList.Item>
        </UnorderedList>
    </UnorderedList.Item>
</UnorderedList>
```


### OrderedList

```tsx
<OrderedList>
    <OrderedList.Item>First step</OrderedList.Item>
    <OrderedList.Item>Second step</OrderedList.Item>
    <OrderedList.Item>Third step</OrderedList.Item>
</OrderedList>
```


## Meow (Argument Parsing)


Meow is the recommended argument parser for Ink CLI apps. It handles `--help`, `--version`, flags, and positional arguments.

```bash
npm install meow
```


### Basic Setup

```tsx
#!/usr/bin/env node
import meow from 'meow';
import { render } from 'ink';
import { App } from './App.js';

const cli = meow(
    `
    Usage
      $ my-cli <command> [options]

    Commands
      init        Initialize a new project
      build       Build the project

    Options
      --name, -n      Your name
      --verbose, -v   Show verbose output
      --config, -c    Path to config file

    Examples
      $ my-cli init --name=myapp
      $ my-cli build --verbose
`,
    {
        importMeta: import.meta,
        flags: {
            name: {
                type: 'string',
                shortFlag: 'n',
            },
            verbose: {
                type: 'boolean',
                shortFlag: 'v',
                default: false,
            },
            config: {
                type: 'string',
                shortFlag: 'c',
                default: './config.json',
            },
        },
    }
);

// cli.input = ['init'] (positional args)
// cli.flags = { name: 'myapp', verbose: false, config: './config.json' }

render(<App command={cli.input[0]} flags={cli.flags} />);
```


### Flag Types

```tsx
const cli = meow(helpText, {
    importMeta: import.meta,
    flags: {
        // String flag
        name: {
            type: 'string',
            shortFlag: 'n',
            default: 'world',
        },

        // Boolean flag
        verbose: {
            type: 'boolean',
            shortFlag: 'v',
            default: false,
        },

        // Number flag
        count: {
            type: 'number',
            shortFlag: 'c',
            default: 1,
        },

        // Required flag (will error if missing)
        token: {
            type: 'string',
            isRequired: true,
        },

        // Multiple values: --file=a.txt --file=b.txt
        file: {
            type: 'string',
            shortFlag: 'f',
            isMultiple: true,
        },

        // Aliases (multiple short flags)
        debug: {
            type: 'boolean',
            aliases: ['d', 'D'],
        },
    },
});
```


### Accessing Values

```tsx
const cli = meow(helpText, { importMeta: import.meta, flags: { /* ... */ } });

// Positional arguments (non-flag arguments)
cli.input;          // ['arg1', 'arg2']
cli.input[0];       // 'arg1'

// Flags
cli.flags;          // { name: 'value', verbose: true, count: 5 }
cli.flags.name;     // 'value'
cli.flags.verbose;  // true

// Unnormalized flags (preserves original casing)
cli.unnormalizedFlags;  // { 'my-flag': 'value' }

// Package info
cli.pkg;            // Contents of package.json

// Show help
cli.showHelp();     // Prints help and exits with code 0
cli.showHelp(1);    // Prints help and exits with code 1

// Show version
cli.showVersion();  // Prints version from package.json
```


### Conditional Rendering Based on Flags

```tsx
#!/usr/bin/env node
import meow from 'meow';
import { render } from 'ink';
import { App } from './App.js';
import { InitCommand } from './commands/Init.js';
import { BuildCommand } from './commands/Build.js';

const cli = meow(
    `
    Usage
      $ my-cli <command>

    Commands
      init    Initialize project
      build   Build project
`,
    {
        importMeta: import.meta,
        flags: {
            help: { type: 'boolean', shortFlag: 'h' },
        },
    }
);

const [command] = cli.input;

switch (command) {
    case 'init':
        render(<InitCommand />);
        break;
    case 'build':
        render(<BuildCommand />);
        break;
    case undefined:
        cli.showHelp();
        break;
    default:
        console.error(`Unknown command: ${command}`);
        cli.showHelp(1);
}
```


### Validation

```tsx
const cli = meow(helpText, {
    importMeta: import.meta,
    flags: {
        port: {
            type: 'number',
            shortFlag: 'p',
            default: 3000,
        },
        env: {
            type: 'string',
            shortFlag: 'e',
            default: 'development',
        },
    },
});

// Manual validation
const { port, env } = cli.flags;

if (port < 1 || port > 65535) {
    console.error('Error: Port must be between 1 and 65535');
    process.exit(1);
}

const validEnvs = ['development', 'staging', 'production'];
if (!validEnvs.includes(env)) {
    console.error(`Error: env must be one of: ${validEnvs.join(', ')}`);
    process.exit(1);
}

render(<App port={port} env={env} />);
```


### TypeScript Types

```tsx
import meow from 'meow';

// Infer flag types automatically
const cli = meow(helpText, {
    importMeta: import.meta,
    flags: {
        name: { type: 'string' },
        count: { type: 'number', default: 0 },
        verbose: { type: 'boolean', default: false },
    },
});

// cli.flags is typed as:
// {
//   name: string | undefined;
//   count: number;
//   verbose: boolean;
// }

// For explicit typing:
interface Flags {
    name?: string;
    count: number;
    verbose: boolean;
}

const flags = cli.flags as Flags;
```


### Complete CLI Example

```tsx
#!/usr/bin/env node
import meow from 'meow';
import { render } from 'ink';
import { App } from './App.js';

const cli = meow(
    `
    Usage
      $ my-cli [options]

    Options
      --name, -n       Your name (required)
      --greeting, -g   Greeting to use (default: Hello)
      --shout, -s      SHOUT THE GREETING
      --times, -t      Repeat greeting N times (default: 1)
      --help, -h       Show this help
      --version        Show version

    Examples
      $ my-cli --name=World
      $ my-cli -n World -g Hi -s
      $ my-cli --name=World --times=3
`,
    {
        importMeta: import.meta,
        flags: {
            name: {
                type: 'string',
                shortFlag: 'n',
                isRequired: true,
            },
            greeting: {
                type: 'string',
                shortFlag: 'g',
                default: 'Hello',
            },
            shout: {
                type: 'boolean',
                shortFlag: 's',
                default: false,
            },
            times: {
                type: 'number',
                shortFlag: 't',
                default: 1,
            },
        },
    }
);

const { name, greeting, shout, times } = cli.flags;

render(
    <App
        name={name}
        greeting={greeting}
        shout={shout}
        times={times}
    />
);
```


## Patterns


### Screen Navigation

```tsx
type Screen = "home" | "settings" | "about";

function App() {
    const [screen, setScreen] = useState<Screen>("home");

    const screens: Record<Screen, ReactNode> = {
        home: <HomeScreen onNavigate={setScreen} />,
        settings: <SettingsScreen onNavigate={setScreen} />,
        about: <AboutScreen onNavigate={setScreen} />,
    };

    return <>{screens[screen]}</>;
}
```


### Navigation with History

```tsx
function useNavigation<T extends string>(initial: T) {
    const [history, setHistory] = useState<T[]>([initial]);

    return {
        current: history[history.length - 1],
        push: (screen: T) => setHistory([...history, screen]),
        pop: () => setHistory(history.slice(0, -1)),
        canGoBack: history.length > 1,
    };
}
```


### Menu Selection

```tsx
function Menu({ items, onSelect }: { items: string[]; onSelect: (i: number) => void }) {
    const [selected, setSelected] = useState(0);

    useInput((input, key) => {
        if (key.upArrow) {
            setSelected((s) => (s > 0 ? s - 1 : items.length - 1));
        }
        if (key.downArrow) {
            setSelected((s) => (s < items.length - 1 ? s + 1 : 0));
        }
        if (key.return) {
            onSelect(selected);
        }
    });

    return (
        <Box flexDirection="column">
            {items.map((item, i) => (
                <Text key={i} color={i === selected ? "cyan" : "white"}>
                    {i === selected ? "> " : "  "}{item}
                </Text>
            ))}
        </Box>
    );
}
```


### Loading State

```tsx
function LoadingExample() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<string | null>(null);

    useEffect(() => {
        fetchData().then((result) => {
            setData(result);
            setLoading(false);
        });
    }, []);

    if (loading) {
        return <Spinner label="Loading data..." />;
    }

    return <Text>{data}</Text>;
}
```


### Form with Multiple Inputs

```tsx
function Form() {
    const [step, setStep] = useState(0);
    const [values, setValues] = useState({ name: "", email: "" });

    const steps = [
        <TextInput
            key="name"
            placeholder="Name"
            onSubmit={(value) => {
                setValues((v) => ({ ...v, name: value }));
                setStep(1);
            }}
        />,
        <TextInput
            key="email"
            placeholder="Email"
            onSubmit={(value) => {
                setValues((v) => ({ ...v, email: value }));
                setStep(2);
            }}
        />,
        <Text key="done" color="green">
            Done! Name: {values.name}, Email: {values.email}
        </Text>,
    ];

    return (
        <Box flexDirection="column">
            <Text bold>Step {step + 1} of 3</Text>
            {steps[step]}
        </Box>
    );
}
```


### Task Runner with Static

```tsx
interface Task {
    id: number;
    name: string;
    status: "pending" | "running" | "done";
}

function TaskRunner({ tasks: initialTasks }: { tasks: string[] }) {
    const [completed, setCompleted] = useState<Task[]>([]);
    const [current, setCurrent] = useState(0);

    useEffect(() => {
        if (current >= initialTasks.length) return;

        const timer = setTimeout(() => {
            setCompleted((prev) => [
                ...prev,
                { id: current, name: initialTasks[current], status: "done" },
            ]);
            setCurrent((c) => c + 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [current, initialTasks]);

    return (
        <>
            <Static items={completed}>
                {(task) => (
                    <Box key={task.id}>
                        <Text color="green">✓ {task.name}</Text>
                    </Box>
                )}
            </Static>

            {current < initialTasks.length && (
                <Spinner label={`Running: ${initialTasks[current]}`} />
            )}

            {current >= initialTasks.length && (
                <Text color="green" bold>All tasks completed!</Text>
            )}
        </>
    );
}
```


### Context for Global State

```tsx
interface AppState {
    user: string | null;
    theme: "light" | "dark";
}

const AppContext = createContext<{
    state: AppState;
    setState: (s: Partial<AppState>) => void;
}>(null!);

function AppProvider({ children }: { children: ReactNode }) {
    const [state, setFullState] = useState<AppState>({
        user: null,
        theme: "dark",
    });

    const setState = (partial: Partial<AppState>) => {
        setFullState((s) => ({ ...s, ...partial }));
    };

    return (
        <AppContext.Provider value={{ state, setState }}>
            {children}
        </AppContext.Provider>
    );
}

function useAppState() {
    return useContext(AppContext);
}
```


## Tips & Gotchas


### Raw Mode Required

Ink needs a real TTY for keyboard input. Running via `npm run start` through a pipe won't work. Run directly:

```bash
node dist/cli.js
```


### All Text Must Be in `<Text>`

```tsx
// Wrong - will error
<Box>Hello</Box>

// Correct
<Box><Text>Hello</Text></Box>
```


### No CSS Units

Ink uses character counts, not pixels:

```tsx
// Width = 50 characters, not pixels
<Box width={50}>...</Box>
```


### Percentage Sizing

Percentages work but need a parent with defined dimensions:

```tsx
<Box width={80}>
    <Box width="50%">  {/* 40 characters */}
        <Text>Half</Text>
    </Box>
</Box>
```


### Console.log Interference

Use `patchConsole: true` in render options, or avoid `console.log`:

```tsx
render(<App />, { patchConsole: true });
```


### Exit Cleanly

Always clean up intervals/timeouts:

```tsx
useEffect(() => {
    const timer = setInterval(() => {}, 1000);
    return () => clearInterval(timer);
}, []);
```


### Focus Management

Only one component should handle input at a time. Use `isActive` option:

```tsx
useInput(handler, { isActive: isFocused });
```


### Testing

Use `ink-testing-library`:

```bash
npm install --save-dev ink-testing-library
```

```tsx
import { render } from "ink-testing-library";

const { lastFrame } = render(<App />);
expect(lastFrame()).toContain("Expected text");
```


### Colors in CI

Colors may not display in CI environments. Check `process.stdout.isTTY`.


### Argument Parsing

Use `meow` or `yargs` for CLI arguments:

```bash
npm install meow
```

```tsx
import meow from "meow";

const cli = meow(`
    Usage
      $ my-cli <input>

    Options
      --name, -n  Your name

    Examples
      $ my-cli --name=Jane
`, {
    importMeta: import.meta,
    flags: {
        name: {
            type: "string",
            shortFlag: "n",
        },
    },
});

console.log(cli.flags.name);
```
