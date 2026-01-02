---
layout: home

hero:
  name: noorm
  text: SQL Without the Ceremony
  tagline: Track changes. Secure credentials. Coordinate your team. No ORM required.
  actions:
    - theme: brand
      text: Get Started
      link: /README
    - theme: alt
      text: View on GitHub
      link: https://github.com/logosdx/noorm

features:
  - icon:
      src: /icons/code-branch.svg
      width: 48
      height: 48
    title: Track Changes
    details: Version-controlled changesets with forward and rollback. Know what ran, when, and by whom.
    link: /changeset
  - icon:
      src: /icons/lock.svg
      width: 48
      height: 48
    title: Secure Credentials
    details: AES-256-GCM encryption. Credentials never leak. Share securely with cryptographic identity.
    link: /state
  - icon:
      src: /icons/users.svg
      width: 48
      height: 48
    title: Team Sync
    details: Lock operations prevent conflicts. Identity tracking shows who did what. Coordinate safely.
    link: /lock
  - icon:
      src: /icons/terminal.svg
      width: 48
      height: 48
    title: For Development
    details: Beautiful TUI for exploring schemas, running queries, and iterating quickly.
    link: /explore
  - icon:
      src: /icons/flask.svg
      width: 48
      height: 48
    title: For Testing
    details: SDK integration with Vitest. Reset, truncate, and seed databases programmatically.
    link: /sdk
  - icon:
      src: /icons/bolt.svg
      width: 48
      height: 48
    title: For CI/CD
    details: Headless mode with JSON output. Run changesets, validate configs, export settings.
    link: /headless
---


## SQL-First Philosophy

You know SQL. Use it. No query builders abstracting your intent. Full power of your dialect—PostgreSQL, MySQL, MSSQL, SQLite.

```bash
# Structure your SQL
schema/
  tables/users.sql
  views/active_users.sql

# Run it
noorm run build
✓ Executed 2 files
✓ Skipped 0 (unchanged)
```


## Works Where You Work

```bash
# Interactive TUI when you're exploring
noorm

# Headless for CI/CD
noorm -H changeset run --json

# SDK for test suites
import { createContext } from 'noorm'
```
