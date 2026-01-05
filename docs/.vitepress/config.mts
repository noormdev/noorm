import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

// https://vitepress.dev/reference/site-config
export default withMermaid(
    defineConfig({
        title: 'noorm',
        description: 'Database Schema & Change Manager',
        base: process.env.VITEPRESS_BASE || '/',
        head: [
            ['link', { rel: 'icon', href: '/image/logo.png' }],
            ['script', { async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-Y69K95866J' }],
            ['script', {}, `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-Y69K95866J');`],
        ],
        vite: {
            resolve: {
                preserveSymlinks: true,
                dedupe: ['ts-dedent', 'mermaid'],
            },
            optimizeDeps: {
                include: ['ts-dedent', 'mermaid'],
            },
            ssr: {
                noExternal: ['mermaid', 'ts-dedent'],
            },
        },
        themeConfig: {
            // https://vitepress.dev/reference/default-theme-config
            logo: '/image/logo.png',
            siteTitle: 'noorm',
            nav: [
                { text: 'Home', link: '/' },
                { text: 'Getting Started', link: '/getting-started/installation' },
                { text: 'Guide', link: '/guide/sql-files/organization' },
                { text: 'TUI', link: '/tui' },
                { text: 'Headless', link: '/headless' },
                {
                    text: 'Dev Docs',
                    link: '/dev/',
                },
            ],

            sidebar: {
                // Dev docs are separate
                '/dev/': [
                    {
                        text: 'Core Modules',
                        items: [
                            { text: 'Overview', link: '/dev/' },
                            { text: 'Change Management', link: '/dev/change' },
                            { text: 'Configuration', link: '/dev/config' },
                            { text: 'Runner', link: '/dev/runner' },
                            { text: 'Settings', link: '/dev/settings' },
                            { text: 'State', link: '/dev/state' },
                        ],
                    },
                    {
                        text: 'Features',
                        items: [
                            { text: 'Database Explorer', link: '/dev/explore' },
                            { text: 'SQL Terminal', link: '/dev/sql-terminal' },
                            { text: 'Templates', link: '/dev/template' },
                            { text: 'Secrets', link: '/dev/secrets' },
                            { text: 'Locking', link: '/dev/lock' },
                            { text: 'Teardown', link: '/dev/teardown' },
                            { text: 'Config Sharing', link: '/dev/config-sharing' },
                        ],
                    },
                    {
                        text: 'Integration',
                        items: [
                            { text: 'SDK', link: '/dev/sdk' },
                            { text: 'Headless Mode', link: '/dev/headless' },
                            { text: 'CI/CD', link: '/dev/ci' },
                            { text: 'Identity', link: '/dev/identity' },
                        ],
                    },
                    {
                        text: 'Reference',
                        items: [
                            { text: 'Data Model', link: '/dev/datamodel' },
                            { text: 'Logger', link: '/dev/logger' },
                            { text: 'Versioning', link: '/dev/version' },
                        ],
                    },
                ],

                // Everything else uses the main sidebar
                '/': [
                    {
                        text: 'Getting Started',
                        items: [
                            { text: 'Installation', link: '/getting-started/installation' },
                            { text: 'First Build', link: '/getting-started/first-build' },
                            { text: 'Building Your SDK', link: '/getting-started/building-your-sdk' },
                            { text: 'Concepts', link: '/getting-started/concepts' },
                        ],
                    },
                    {
                        text: 'Features',
                        items: [
                            { text: 'Terminal UI', link: '/tui' },
                            { text: 'Headless Mode', link: '/headless' },
                        ],
                    },
                    {
                        text: 'SQL Files',
                        collapsed: true,
                        items: [
                            { text: 'Organization', link: '/guide/sql-files/organization' },
                            { text: 'Templates', link: '/guide/sql-files/templates' },
                            { text: 'Execution', link: '/guide/sql-files/execution' },
                        ],
                    },
                    {
                        text: 'Environments',
                        collapsed: true,
                        items: [
                            { text: 'Configs', link: '/guide/environments/configs' },
                            { text: 'Stages', link: '/guide/environments/stages' },
                            { text: 'Secrets', link: '/guide/environments/secrets' },
                        ],
                    },
                    {
                        text: 'Changes',
                        collapsed: true,
                        items: [
                            { text: 'Overview', link: '/guide/changes/overview' },
                            { text: 'Forward & Revert', link: '/guide/changes/forward-revert' },
                            { text: 'History', link: '/guide/changes/history' },
                        ],
                    },
                    {
                        text: 'Database',
                        collapsed: true,
                        items: [
                            { text: 'Explorer', link: '/guide/database/explore' },
                            { text: 'Teardown', link: '/guide/database/teardown' },
                            { text: 'Terminal', link: '/guide/database/terminal' },
                        ],
                    },
                    {
                        text: 'Reference',
                        items: [
                            { text: 'SDK', link: '/reference/sdk' },
                        ],
                    },
                ],
            },

            socialLinks: [
                { icon: 'github', link: 'https://github.com/noormdev/noorm' },
            ],

            search: {
                provider: 'local',
            },

            outline: {
                level: [2, 3],
            },
        },
    }),
);
