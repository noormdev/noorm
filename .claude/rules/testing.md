---
paths: tests/**/*.{ts,tsx}
---

# Testing Rules


## Commands

```bash
yarn test                       # Run all tests
yarn test:watch                 # Watch mode
yarn test:coverage              # With coverage
```


## Naming

Use `describe('module: feature', () => {})` format. Group by module, then by feature.

```ts
describe('runner: executeFile', () => {

    it('should skip unchanged files', async () => {
        // ...
    })

    it('should emit error event on failure', async () => {
        // ...
    })
})
```


## Coverage

Test all paths: success, error, edge cases. Verify observer events are emitted with correct data.

```ts
it('should emit error event on failure', async () => {

    const events: any[] = []
    observer.on('file:after', (data) => events.push(data))

    const [_, err] = await attempt(() => executeFile(badFile, configName))

    expect(err).toBeInstanceOf(Error)
    expect(events[0].status).toBe('failed')
})
```


## Error Handling

Use `attempt` for operations that may fail. Assert both the error and any side effects.

```ts
const [result, err] = await attempt(() => executeFile(badPath))
expect(err).toBeInstanceOf(InvalidFileError)
expect(result).toBeUndefined()
```
