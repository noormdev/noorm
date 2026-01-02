import { defineConfig } from 'vitepress'
import { generateSidebar } from 'vitepress-sidebar'
import { withMermaid } from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(
    defineConfig({
        title: "noorm",
        description: "Database Schema & Changeset Manager",
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
                { text: 'Getting Started', link: '/README' },
                { text: 'CLI', link: '/headless' },
                { text: 'SDK', link: '/sdk' }
            ],

            sidebar: generateSidebar({
                documentRootPath: '.',
                useTitleFromFileHeading: true,
                collapsed: false,
                capitalizeEachWords: true,
                hyphenToSpace: true,
            }),

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
