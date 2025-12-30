/**
 * Platform-agnostic clipboard utility.
 *
 * Uses native OS commands for clipboard operations:
 * - macOS: pbcopy
 * - Linux: xclip (with xsel fallback)
 * - Windows: clip
 */
import { execSync } from 'child_process'
import { platform } from 'os'

import { attemptSync } from '@logosdx/utils'


/**
 * Copy text to the system clipboard.
 *
 * @param text - Text to copy
 * @throws Error if clipboard operation fails or platform unsupported
 */
export function copyToClipboard(text: string): void {
    const os = platform()

    if (os === 'darwin') {
        execSync('pbcopy', { input: text, encoding: 'utf8' })
        return
    }

    if (os === 'linux') {
        // Try xclip first, fall back to xsel
        const [, xclipErr] = attemptSync(() =>
            execSync('xclip -selection clipboard', { input: text, encoding: 'utf8' }),
        )

        if (!xclipErr) return

        const [, xselErr] = attemptSync(() =>
            execSync('xsel --clipboard --input', { input: text, encoding: 'utf8' }),
        )

        if (!xselErr) return

        throw new Error('No clipboard utility found. Install xclip or xsel.')
    }

    if (os === 'win32') {
        execSync('clip', { input: text, encoding: 'utf8' })
        return
    }

    throw new Error(`Clipboard not supported on ${os}`)
}


/**
 * Check if clipboard operations are available on this platform.
 *
 * @returns true if clipboard is available
 */
export function isClipboardAvailable(): boolean {
    const os = platform()

    if (os === 'darwin' || os === 'win32') {
        return true
    }

    if (os === 'linux') {
        // Check if xclip or xsel exists
        const [, xclipErr] = attemptSync(() => execSync('which xclip', { encoding: 'utf8' }))
        if (!xclipErr) return true

        const [, xselErr] = attemptSync(() => execSync('which xsel', { encoding: 'utf8' }))
        if (!xselErr) return true

        return false
    }

    return false
}
