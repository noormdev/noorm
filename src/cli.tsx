#!/usr/bin/env node
import meow from 'meow';
import { render } from 'ink';
import { App } from './App.js';

const cli = meow(
    `
    Usage
      $ noorm

    Options
      --version, -v  Show version
      --help, -h     Show help

    Examples
      $ noorm
`,
    {
        importMeta: import.meta,
        flags: {
            help: {
                type: 'boolean',
                shortFlag: 'h',
            },
            version: {
                type: 'boolean',
                shortFlag: 'v',
            },
        },
    }
);

if (cli.flags.help) {
    cli.showHelp();
} else {
    render(<App />, {
        exitOnCtrlC: true,
    });
}
