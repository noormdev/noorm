import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(
    defineConfig({
        title: "noorm",
        description: "Database Schema & Change Manager",
        base: process.env.VITEPRESS_BASE || '/',
        vite: {
            resolve: {
                preserveSymlinks: true,
                dedupe: ['ts-dedent', 'mermaid']
            },
            optimizeDeps: {
                include: ['ts-dedent', 'mermaid']
            },
            ssr: {
                noExternal: ['mermaid', 'ts-dedent']
            }
        },
        themeConfig: {
            // https://vitepress.dev/reference/default-theme-config
            siteTitle: '> noorm_',
            nav: [
                { text: 'Home', link: '/' },
                { text: 'Getting Started', link: '/getting-started/installation' },
                { text: 'Guide', link: '/guide/sql-files/organization' },
                { text: 'TUI', link: '/tui' },
                { text: 'Headless', link: '/headless' },
                {
                    text: 'Dev Docs',
                    link: '/dev/'
                }
            ],

            sidebar: {
                '/getting-started/': [
                    {
                        text: 'Getting Started',
                        items: [
                            { text: 'Installation', link: '/getting-started/installation' },
                            { text: 'First Build', link: '/getting-started/first-build' },
                            { text: 'Concepts', link: '/getting-started/concepts' }
                        ]
                    }
                ],
                '/guide/': [
                    {
                        text: 'SQL Files',
                        items: [
                            { text: 'Organization', link: '/guide/sql-files/organization' },
                            { text: 'Templates', link: '/guide/sql-files/templates' },
                            { text: 'Execution', link: '/guide/sql-files/execution' }
                        ]
                    },
                    {
                        text: 'Environments',
                        items: [
                            { text: 'Configs', link: '/guide/environments/configs' },
                            { text: 'Stages', link: '/guide/environments/stages' },
                            { text: 'Secrets', link: '/guide/environments/secrets' }
                        ]
                    },
                    {
                        text: 'Migrations',
                        items: [
                            { text: 'Changes', link: '/guide/migrations/changes' },
                            { text: 'Forward & Revert', link: '/guide/migrations/forward-revert' },
                            { text: 'History', link: '/guide/migrations/history' }
                        ]
                    },
                    {
                        text: 'Database',
                        items: [
                            { text: 'Explorer', link: '/guide/database/explore' },
                            { text: 'Teardown', link: '/guide/database/teardown' },
                            { text: 'Terminal', link: '/guide/database/terminal' }
                        ]
                    }
                ],
                '/dev/': [
                    {
                        text: 'Core Modules',
                        items: [
                            { text: 'Overview', link: '/dev/' },
                            { text: 'Change Management', link: '/dev/change' },
                            { text: 'Configuration', link: '/dev/config' },
                            { text: 'Runner', link: '/dev/runner' },
                            { text: 'Settings', link: '/dev/settings' },
                            { text: 'State', link: '/dev/state' }
                        ]
                    },
                    {
                        text: 'Features',
                        items: [
                            { text: 'Database Explorer', link: '/dev/explore' },
                            { text: 'SQL Terminal', link: '/dev/sql-terminal' },
                            { text: 'Templates', link: '/dev/template' },
                            { text: 'Secrets', link: '/dev/secrets' },
                            { text: 'Locking', link: '/dev/lock' },
                            { text: 'Teardown', link: '/dev/teardown' }
                        ]
                    },
                    {
                        text: 'Integration',
                        items: [
                            { text: 'SDK', link: '/dev/sdk' },
                            { text: 'Headless Mode', link: '/dev/headless' },
                            { text: 'CI/CD', link: '/dev/ci' },
                            { text: 'Identity', link: '/dev/identity' }
                        ]
                    },
                    {
                        text: 'Reference',
                        items: [
                            { text: 'Data Model', link: '/dev/datamodel' },
                            { text: 'Logger', link: '/dev/logger' },
                            { text: 'Versioning', link: '/dev/version' }
                        ]
                    }
                ],
                '/': [
                    {
                        text: 'Quick Start',
                        items: [
                            { text: 'Installation', link: '/getting-started/installation' },
                            { text: 'First Build', link: '/getting-started/first-build' },
                            { text: 'Concepts', link: '/getting-started/concepts' }
                        ]
                    },
                    {
                        text: 'Features',
                        items: [
                            { text: 'Terminal UI', link: '/tui' },
                            { text: 'Headless Mode', link: '/headless' }
                        ]
                    },
                    {
                        text: 'Guide',
                        items: [
                            { text: 'SQL Files', link: '/guide/sql-files/organization' },
                            { text: 'Environments', link: '/guide/environments/configs' },
                            { text: 'Migrations', link: '/guide/migrations/changes' },
                            { text: 'Database', link: '/guide/database/explore' }
                        ]
                    }
                ]
            },

            socialLinks: [
                { icon: 'github', link: 'https://github.com/logosdx/noorm' }
            ],

            search: {
                provider: 'local'
            },

            outline: {
                level: [2, 3]
            }
        },
    })
)
