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
import './brand.css'

// Add icons to library
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
    }
}
