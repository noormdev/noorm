# Developer Documentation


These docs are for contributors and maintainers. They cover internal architecture, implementation details, and design decisions.

For user-facing documentation, see the [main docs](/).


## Core Modules

- [Project Discovery](./project-discovery.md) - Finding project root from any directory
- [Change Management](./change.md) - Versioned changes with forward/revert
- [Configuration](./config.md) - Multi-source config resolution
- [Runner](./runner.md) - SQL file execution with checksums
- [Settings](./settings.md) - Project-wide configuration
- [State](./state.md) - Encrypted local state storage


## Features

- [Database Explorer](./explore.md) - Schema introspection
- [SQL Terminal](./sql-terminal.md) - Interactive REPL
- [Templates](./template.md) - Eta templating engine
- [Secrets](./secrets.md) - Encrypted secret storage
- [Locking](./lock.md) - Concurrency control
- [Teardown](./teardown.md) - Database reset operations


## Integration

- [SDK](./sdk.md) - Programmatic API
- [Headless Mode](./headless.md) - CLI automation
- [CI/CD](./ci.md) - Pipeline patterns
- [Identity](./identity.md) - Audit and cryptographic identity


## Reference

- [Data Model](./datamodel.md) - Types and schemas
- [Logger](./logger.md) - Event-based logging
- [Versioning](./version.md) - Schema migrations
