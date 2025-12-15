# Ink Testing Library Cheatsheet


A comprehensive reference for testing Ink CLI applications with ink-testing-library.


## Table of Contents


- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [API Reference](#api-reference)
- [Testing Patterns](#testing-patterns)
- [Testing Input](#testing-input)
- [Testing Async Components](#testing-async-components)
- [Tips & Gotchas](#tips--gotchas)


## Installation


```bash
npm install --save-dev ink-testing-library
```


## Basic Usage


```tsx
import { render } from "ink-testing-library";
import { Text } from "ink";

function Greeting({ name }: { name: string }) {

    return <Text>Hello, {name}!</Text>;
}

// Render and check output
const { lastFrame } = render(<Greeting name="World" />);
expect(lastFrame()).toBe("Hello, World!");
```


### With Rerender

```tsx
import { render } from "ink-testing-library";
import { Text } from "ink";

function Counter({ count }: { count: number }) {

    return <Text>Count: {count}</Text>;
}

const { lastFrame, rerender } = render(<Counter count={0} />);
expect(lastFrame()).toBe("Count: 0");

rerender(<Counter count={1} />);
expect(lastFrame()).toBe("Count: 1");
```


## API Reference


### render(tree)

Renders a React element for testing.

```tsx
const instance = render(<App />);
```


#### Return Object

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `lastFrame()` | `() => string \| undefined` | Returns the last rendered output |
| `frames` | `string[]` | Array of all rendered frames |
| `rerender(tree)` | `(tree: ReactElement) => void` | Re-render with new component/props |
| `unmount()` | `() => void` | Unmount the component |
| `stdin` | `{ write: (data: string) => void }` | Simulate stdin input |
| `stdout` | `{ lastFrame: () => string, frames: string[] }` | Access stdout output |
| `stderr` | `{ lastFrame: () => string, frames: string[] }` | Access stderr output |


### lastFrame()

Returns the last rendered output as a string.

```tsx
const { lastFrame } = render(<Text>Hello</Text>);
expect(lastFrame()).toBe("Hello");
```


### frames

Array containing all rendered outputs across the component lifecycle.

```tsx
const { frames, rerender } = render(<Counter count={0} />);
rerender(<Counter count={1} />);
rerender(<Counter count={2} />);

expect(frames).toEqual([
    "Count: 0",
    "Count: 1",
    "Count: 2",
]);
```


### rerender(tree)

Updates the component with new props or replaces it entirely.

```tsx
const { lastFrame, rerender } = render(<Greeting name="Alice" />);
expect(lastFrame()).toBe("Hello, Alice!");

rerender(<Greeting name="Bob" />);
expect(lastFrame()).toBe("Hello, Bob!");
```


### unmount()

Unmounts the component. Useful for testing cleanup effects.

```tsx
const { unmount } = render(<App />);

// Test cleanup
unmount();
```


### stdin.write(data)

Simulates user keyboard input.

```tsx
import { useInput, Text } from "ink";

function InputHandler() {

    const [input, setInput] = useState("");

    useInput((char) => {

        setInput((prev) => prev + char);
    });

    return <Text>Input: {input}</Text>;
}

const { stdin, lastFrame } = render(<InputHandler />);
stdin.write("abc");
expect(lastFrame()).toBe("Input: abc");
```


### stdout / stderr

Access stdout and stderr streams separately.

```tsx
const { stdout, stderr } = render(<App />);

// Check stdout
expect(stdout.lastFrame()).toBe("Output");
expect(stdout.frames).toHaveLength(3);

// Check stderr
expect(stderr.lastFrame()).toBe("Error message");
```


## Testing Patterns


### Testing Static Output

```tsx
import { render } from "ink-testing-library";
import { Box, Text } from "ink";

function StatusBar({ status }: { status: string }) {

    return (
        <Box>
            <Text color="green">Status: </Text>
            <Text>{status}</Text>
        </Box>
    );
}

describe("StatusBar", () => {

    it("should display status text", () => {

        const { lastFrame } = render(<StatusBar status="Ready" />);
        expect(lastFrame()).toContain("Status:");
        expect(lastFrame()).toContain("Ready");
    });
});
```


### Testing Conditional Rendering

```tsx
function LoadingState({ isLoading }: { isLoading: boolean }) {

    if (isLoading) {

        return <Text>Loading...</Text>;
    }

    return <Text>Done!</Text>;
}

describe("LoadingState", () => {

    it("should show loading state", () => {

        const { lastFrame } = render(<LoadingState isLoading={true} />);
        expect(lastFrame()).toBe("Loading...");
    });

    it("should show done state", () => {

        const { lastFrame } = render(<LoadingState isLoading={false} />);
        expect(lastFrame()).toBe("Done!");
    });

    it("should transition from loading to done", () => {

        const { lastFrame, rerender } = render(<LoadingState isLoading={true} />);
        expect(lastFrame()).toBe("Loading...");

        rerender(<LoadingState isLoading={false} />);
        expect(lastFrame()).toBe("Done!");
    });
});
```


### Testing Lists

```tsx
function ItemList({ items }: { items: string[] }) {

    return (
        <Box flexDirection="column">
            {items.map((item, i) => (
                <Text key={i}>- {item}</Text>
            ))}
        </Box>
    );
}

describe("ItemList", () => {

    it("should render all items", () => {

        const items = ["Apple", "Banana", "Cherry"];
        const { lastFrame } = render(<ItemList items={items} />);

        expect(lastFrame()).toContain("- Apple");
        expect(lastFrame()).toContain("- Banana");
        expect(lastFrame()).toContain("- Cherry");
    });

    it("should handle empty list", () => {

        const { lastFrame } = render(<ItemList items={[]} />);
        expect(lastFrame()).toBe("");
    });
});
```


### Testing with Snapshots

```tsx
describe("ComplexComponent", () => {

    it("should match snapshot", () => {

        const { lastFrame } = render(<ComplexComponent />);
        expect(lastFrame()).toMatchSnapshot();
    });
});
```


## Testing Input


### Testing useInput Hook

```tsx
import { useState } from "react";
import { useInput, Text } from "ink";
import { render } from "ink-testing-library";

function NavigableMenu({ items }: { items: string[] }) {

    const [selected, setSelected] = useState(0);

    useInput((input, key) => {

        if (key.upArrow) {

            setSelected((s) => Math.max(0, s - 1));
        }

        if (key.downArrow) {

            setSelected((s) => Math.min(items.length - 1, s + 1));
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

describe("NavigableMenu", () => {

    it("should navigate with arrow keys", () => {

        const items = ["Option 1", "Option 2", "Option 3"];
        const { stdin, lastFrame } = render(<NavigableMenu items={items} />);

        expect(lastFrame()).toContain("> Option 1");

        // Simulate down arrow (ANSI escape sequence)
        stdin.write("\x1B[B");
        expect(lastFrame()).toContain("> Option 2");

        stdin.write("\x1B[B");
        expect(lastFrame()).toContain("> Option 3");

        // Simulate up arrow
        stdin.write("\x1B[A");
        expect(lastFrame()).toContain("> Option 2");
    });
});
```


### ANSI Escape Sequences for Keys

| Key | Escape Sequence |
|-----|-----------------|
| Up Arrow | `\x1B[A` |
| Down Arrow | `\x1B[B` |
| Right Arrow | `\x1B[C` |
| Left Arrow | `\x1B[D` |
| Enter/Return | `\r` |
| Escape | `\x1B` |
| Tab | `\t` |
| Backspace | `\x7F` |
| Delete | `\x1B[3~` |
| Ctrl+C | `\x03` |


### Testing Character Input

```tsx
function TextCollector() {

    const [text, setText] = useState("");

    useInput((input, key) => {

        if (key.return) {

            return;
        }

        if (key.backspace) {

            setText((t) => t.slice(0, -1));
            return;
        }

        setText((t) => t + input);
    });

    return <Text>Text: {text}</Text>;
}

describe("TextCollector", () => {

    it("should collect typed characters", () => {

        const { stdin, lastFrame } = render(<TextCollector />);

        stdin.write("h");
        stdin.write("e");
        stdin.write("l");
        stdin.write("l");
        stdin.write("o");

        expect(lastFrame()).toBe("Text: hello");
    });

    it("should handle backspace", () => {

        const { stdin, lastFrame } = render(<TextCollector />);

        stdin.write("hello");
        stdin.write("\x7F"); // Backspace

        expect(lastFrame()).toBe("Text: hell");
    });
});
```


## Testing Async Components


### Testing useEffect

```tsx
import { useState, useEffect } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";

function AsyncLoader() {

    const [data, setData] = useState<string | null>(null);

    useEffect(() => {

        const timer = setTimeout(() => {

            setData("Loaded!");
        }, 100);

        return () => clearTimeout(timer);
    }, []);

    if (!data) {

        return <Text>Loading...</Text>;
    }

    return <Text>{data}</Text>;
}

describe("AsyncLoader", () => {

    it("should show loading then loaded state", async () => {

        const { lastFrame } = render(<AsyncLoader />);

        expect(lastFrame()).toBe("Loading...");

        // Wait for async operation
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(lastFrame()).toBe("Loaded!");
    });
});
```


### Testing with Fake Timers

```tsx
import { jest } from "@jest/globals";

describe("AsyncLoader with fake timers", () => {

    beforeEach(() => {

        jest.useFakeTimers();
    });

    afterEach(() => {

        jest.useRealTimers();
    });

    it("should transition states", () => {

        const { lastFrame } = render(<AsyncLoader />);

        expect(lastFrame()).toBe("Loading...");

        jest.advanceTimersByTime(150);

        expect(lastFrame()).toBe("Loaded!");
    });
});
```


### Testing Promises

```tsx
function DataFetcher({ fetchFn }: { fetchFn: () => Promise<string> }) {

    const [data, setData] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {

        fetchFn()
            .then(setData)
            .catch((err) => setError(err.message));
    }, [fetchFn]);

    if (error) return <Text color="red">Error: {error}</Text>;
    if (!data) return <Text>Loading...</Text>;
    return <Text>{data}</Text>;
}

describe("DataFetcher", () => {

    it("should display fetched data", async () => {

        const mockFetch = jest.fn().mockResolvedValue("Fetched data");
        const { lastFrame } = render(<DataFetcher fetchFn={mockFetch} />);

        expect(lastFrame()).toBe("Loading...");

        await new Promise(process.nextTick);

        expect(lastFrame()).toBe("Fetched data");
    });

    it("should display error on failure", async () => {

        const mockFetch = jest.fn().mockRejectedValue(new Error("Network error"));
        const { lastFrame } = render(<DataFetcher fetchFn={mockFetch} />);

        await new Promise(process.nextTick);

        expect(lastFrame()).toContain("Error: Network error");
    });
});
```


## Tips & Gotchas


### Colors Are Stripped

ink-testing-library strips ANSI color codes from output. Test content, not colors:

```tsx
// This works - testing content
expect(lastFrame()).toContain("Success");

// Colors are not visible in test output
// <Text color="green">Success</Text> renders as just "Success"
```


### Frame Timing

Frames are captured synchronously. For async updates, wait before checking:

```tsx
// Wrong - may not capture async update
const { lastFrame } = render(<AsyncComponent />);
expect(lastFrame()).toBe("Updated"); // May fail

// Correct - wait for update
const { lastFrame } = render(<AsyncComponent />);
await new Promise((resolve) => setTimeout(resolve, 100));
expect(lastFrame()).toBe("Updated");
```


### Testing Hooks in Isolation

Create wrapper components to test hooks:

```tsx
function TestWrapper({ onInput }: { onInput: (input: string) => void }) {

    useInput((input) => {

        onInput(input);
    });

    return <Text>Test</Text>;
}

it("should capture input", () => {

    const onInput = jest.fn();
    const { stdin } = render(<TestWrapper onInput={onInput} />);

    stdin.write("x");

    expect(onInput).toHaveBeenCalledWith("x");
});
```


### Testing useApp Exit

```tsx
import { useApp, Text } from "ink";

function ExitOnQ() {

    const { exit } = useApp();

    useInput((input) => {

        if (input === "q") {

            exit();
        }
    });

    return <Text>Press q to quit</Text>;
}

describe("ExitOnQ", () => {

    it("should call exit on q press", () => {

        const { stdin, unmount } = render(<ExitOnQ />);

        // Component should handle exit gracefully
        stdin.write("q");

        // Clean up
        unmount();
    });
});
```


### Testing Focus

```tsx
import { useFocus, Text } from "ink";

function FocusableItem({ id }: { id: string }) {

    const { isFocused } = useFocus({ id });

    return (
        <Text color={isFocused ? "green" : "white"}>
            {isFocused ? "> " : "  "}Item {id}
        </Text>
    );
}

describe("FocusableItem", () => {

    it("should show focus indicator when focused", () => {

        const { lastFrame, stdin } = render(
            <Box flexDirection="column">
                <FocusableItem id="1" />
                <FocusableItem id="2" />
            </Box>
        );

        // First item focused by default (if autoFocus)
        expect(lastFrame()).toContain("> Item 1");

        // Tab to next item
        stdin.write("\t");
        expect(lastFrame()).toContain("> Item 2");
    });
});
```


### Cleanup Between Tests

Always unmount or let jest handle cleanup:

```tsx
describe("MyComponent", () => {

    let instance: ReturnType<typeof render>;

    afterEach(() => {

        instance?.unmount();
    });

    it("test 1", () => {

        instance = render(<MyComponent />);
        // ...
    });

    it("test 2", () => {

        instance = render(<MyComponent />);
        // ...
    });
});
```


### Debugging Test Output

```tsx
it("should render correctly", () => {

    const { lastFrame, frames } = render(<MyComponent />);

    // Debug: log all frames
    console.log("All frames:", frames);

    // Debug: log current output
    console.log("Current:", lastFrame());

    expect(lastFrame()).toContain("expected");
});
```
