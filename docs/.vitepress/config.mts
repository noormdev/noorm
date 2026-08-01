import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

// https://vitepress.dev/reference/site-config
const SITE_URL = 'https://noorm.dev';
const TITLE = 'noorm — Write SQL. Skip the ORM.';
const DESCRIPTION = 'A SQL-first schema and change manager for Postgres, MySQL, SQLite, and MSSQL. Your schema lives in SQL files. noorm builds it, versions it, and keeps every environment in sync.';

export default withMermaid(
    defineConfig({
        title: 'noorm',
        description: DESCRIPTION,
        base: process.env.VITEPRESS_BASE || '/',

        // `docs/wiki/` is generated repo-analysis output for tooling and
        // contributors, not published documentation. VitePress compiles every
        // markdown file it finds as a Vue SFC, so its angle-bracket prose
        // (`<steering note: ...>`) is parsed as a tag with an illegal
        // attribute and fails the build — which is why the site stopped
        // deploying after 2026-07-04.
        //
        // The rest are the same class of thing: specs, design notes, scratch
        // output, and the tape sources, none of which are published pages.
        srcExclude: ['wiki/**', 'spec/**', 'design/**', 'superpowers/**', 'tmp/**', 'tapes/**'],

        markdown: {
            // The terminal recordings are the heaviest assets on the site
            // (tui.gif alone is ~1.6 MB) and none of them sit above the fold.
            image: { lazyLoading: true },
        },

        // `title` above only sets the <title> suffix; titleTemplate gives the home
        // page a real headline instead of the bare word "noorm".
        titleTemplate: ':title · noorm',

        // Crawlers and chat apps do not run JS, so og:* must be static and absolute.
        // The `title`/`description` config fields cover <title> and <meta name>;
        // everything social has to be spelled out here.
        head: [
            ['link', { rel: 'icon', href: '/image/logo.svg', type: 'image/svg+xml' }],
            ['link', { rel: 'apple-touch-icon', href: '/image/logo.png' }],
            ['link', { rel: 'canonical', href: `${SITE_URL}/` }],
            ['meta', { name: 'theme-color', content: '#E05742' }],

            ['meta', { property: 'og:type', content: 'website' }],
            ['meta', { property: 'og:site_name', content: 'noorm' }],
            ['meta', { property: 'og:url', content: `${SITE_URL}/` }],
            ['meta', { property: 'og:title', content: TITLE }],
            ['meta', { property: 'og:description', content: DESCRIPTION }],
            ['meta', { property: 'og:image', content: `${SITE_URL}/image/og.png` }],
            ['meta', { property: 'og:image:width', content: '1200' }],
            ['meta', { property: 'og:image:height', content: '630' }],
            ['meta', { property: 'og:image:alt', content: 'noorm — Write SQL. Skip the ORM.' }],

            ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
            ['meta', { name: 'twitter:title', content: TITLE }],
            ['meta', { name: 'twitter:description', content: DESCRIPTION }],
            ['meta', { name: 'twitter:image', content: `${SITE_URL}/image/og.png` }],

            ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
            ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
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
            logo: '/image/logo.svg',
            siteTitle: 'noorm',
            nav: [
                { text: 'Home', link: '/' },
                { text: 'Getting Started', link: '/getting-started/installation' },
                { text: 'Guide', link: '/guide/sql-files/organization' },
                { text: 'CLI', link: '/headless' },
                { text: 'TUI', link: '/tui' },
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
                            { text: 'Vault', link: '/dev/vault' },
                            { text: 'Locking', link: '/dev/lock' },
                            { text: 'Teardown', link: '/dev/teardown' },
                            { text: 'Config Sharing', link: '/dev/config-sharing' },
                        ],
                    },
                    {
                        text: 'Integration',
                        items: [
                            { text: 'SDK', link: '/dev/sdk' },
                            { text: 'CLI Architecture', link: '/dev/headless' },
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
                            { text: 'CLI Reference', link: '/headless' },
                            { text: 'Terminal UI', link: '/tui' },
                            { text: 'Relational Design', link: '/guide/relational-design' },
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
                            { text: 'Vault', link: '/guide/environments/vault' },
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
                            { text: 'Transfer', link: '/guide/database/transfer' },
                            { text: 'Teardown', link: '/guide/database/teardown' },
                            { text: 'Terminal', link: '/guide/database/terminal' },
                        ],
                    },
                    {
                        text: 'Automation',
                        collapsed: true,
                        items: [
                            { text: 'CI/CD', link: '/guide/automation/ci' },
                            { text: 'MCP (AI Agents)', link: '/guide/automation/mcp' },
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
                options: {
                    translations: {
                        button: {
                            buttonText: 'Search docs',
                            buttonAriaLabel: 'Search docs',
                        },
                    },
                },
            },

            outline: {
                level: [2, 3],
            },

            footer: {
                message: 'Database Schema & Change Manager',
                copyright: `© ${new Date().getFullYear()} <a href="https://github.com/noormdev">noorm</a> · <a href="https://github.com/noormdev/noorm">GitHub</a> · <a href="https://www.npmjs.com/org/noormdev">npm</a> · ISC License`,
            },
        },
    }),
);
