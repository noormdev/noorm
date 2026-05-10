<template>
    <div class="hero-terminal">
        <div class="terminal-header">
            <span class="terminal-label">bash · install.sh</span>
            <button class="terminal-copy" @click="copy">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                {{ copied ? 'copied' : 'copy' }}
            </button>
        </div>
        <div class="terminal-body">
            <div class="line comment"># Install (no sudo)</div>
            <div class="line"><span class="prompt">$</span> curl -fsSL <span class="url">https://noorm.dev/install.sh</span> | sh</div>
            <div class="line spacer"></div>
            <div class="line"><span class="prompt">$</span> cd /my/project &amp;&amp; noorm init</div>
            <div class="line"><span class="prompt">$</span> npm i <span class="arg">@noorm/sdk</span></div>
            <div class="line spacer"></div>
            <div class="line"><span class="prompt">$</span> noorm run build<span class="cursor"></span></div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'

const copied = ref(false)

function copy() {
    const text = `curl -fsSL https://noorm.dev/install.sh | sh\ncd /my/project && noorm init\nnpm i @noorm/sdk\nnoorm run build`
    navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
}
</script>

<style scoped>
.hero-terminal {
    width: 100%;
    max-width: 520px;
    border-radius: 10px;
    border: 1px solid var(--vp-c-border);
    background: var(--vp-code-block-bg, var(--vp-c-bg-alt));
    font-family: var(--vp-font-family-mono);
    font-size: 0.8125rem;
    line-height: 1.7;
    overflow: hidden;
    box-shadow:
        0 0 1rem rgba(0, 0, 0, 0.15),
        0 0 3rem rgba(0, 0, 0, 0.1);
}

.terminal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--vp-c-border);
}

.terminal-label {
    font-size: 0.75rem;
    color: var(--vp-c-text-3);
    letter-spacing: 0.01em;
}

.terminal-copy {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    font-family: var(--vp-font-family-mono);
    font-size: 0.75rem;
    color: var(--vp-c-text-3);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 120ms ease;
}

.terminal-copy:hover {
    color: var(--vp-c-text-1);
}

.terminal-body {
    padding: 16px 20px;
}

.line {
    white-space: pre;
    color: var(--vp-c-text-1);
}

.line.spacer {
    height: 0.85em;
}

.line.comment {
    color: var(--vp-c-text-3);
}

.line.output {
    padding-left: 1em;
    color: var(--vp-c-text-2);
}

.prompt {
    color: var(--vp-c-text-3);
    margin-right: 0.5em;
}

.url {
    color: #6E4A22;
}

.dark .url {
    color: #D2A47A;
}

.check {
    color: #6E8F4E;
    margin-right: 0.25em;
}

.arg {
    color: #6E8F4E;
}

.cursor {
    display: inline-block;
    width: 0.55em;
    height: 1.1em;
    background: #E05742;
    vertical-align: text-bottom;
    animation: blink 1s step-end infinite;
}

@keyframes blink {
    50% { opacity: 0; }
}
</style>
