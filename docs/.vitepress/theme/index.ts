import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
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
import HeroTerminal from './HeroTerminal.vue'
import HeroEyebrow from './HeroEyebrow.vue'
import HeroStats from './HeroStats.vue'
import './brand.css'

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
    Layout() {
        return h(DefaultTheme.Layout, null, {
            'home-hero-info-before': () => h(HeroEyebrow),
            'home-hero-image': () => h(HeroTerminal),
            'home-hero-actions-after': () => h(HeroStats),
        })
    },
    enhanceApp({ app }) {
        app.component('FontAwesomeIcon', FontAwesomeIcon)
    }
}
