import DefaultTheme from 'vitepress/theme'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
    faCodeBranch,
    faLock,
    faUsers,
    faTerminal,
    faFlask,
    faBolt,
    faDatabase,
    faFileCode,
    faShield,
    faGear,
    faRocket,
    faBook
} from '@fortawesome/free-solid-svg-icons'
import { faGithub } from '@fortawesome/free-brands-svg-icons'
import mermaid from 'mermaid'
import ModelViewer from './ModelViewer.vue'
import './brand.css'
import './landing.css'

library.add(
    faCodeBranch,
    faLock,
    faUsers,
    faTerminal,
    faFlask,
    faBolt,
    faDatabase,
    faFileCode,
    faShield,
    faGear,
    faRocket,
    faBook,
    faGithub
)

export default {
    extends: DefaultTheme,
    enhanceApp({ app }) {
        app.component('FontAwesomeIcon', FontAwesomeIcon)
        app.component('ModelViewer', ModelViewer)

        // Mermaid measures each label once and memoizes the width, so a render before
        // Geist loads keeps fallback-font widths for good. Hold every render until it is in.
        if (typeof document !== 'undefined') {
            // load() resolves at once while the font stylesheet has not registered its
            // @font-face rules, so wait for the rules (up to 3s), then for the files.
            const fontsReady = (async () => {
                const hasGeist = () => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Geist')
                const deadline = Date.now() + 3000
                while (!hasGeist() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
                await Promise.allSettled(['400', '600'].map((w) => document.fonts.load(`${w} 14px Geist`)))
            })()
            const render = mermaid.render.bind(mermaid)
            mermaid.render = async (...args: Parameters<typeof render>) => {
                await fontsReady
                return render(...args)
            }
        }
    }
}
