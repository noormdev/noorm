<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useData, withBase } from 'vitepress'

const props = withDefaults(defineProps<{
    model: string
    title: string
    hash?: string
    tabs?: boolean
    label?: string
    caption?: string
}>(), {
    hash: 'view=graph',
    tabs: true,
    label: '',
    caption: 'rendered by ignatius',
})

const views = [
    { hash: 'view=graph', label: 'Graph' },
    { hash: 'view=dict', label: 'Dictionary' },
    { hash: 'view=flow', label: 'Flows' },
]

const { isDark } = useData()
const frame = ref<HTMLIFrameElement | null>(null)
const active = ref(props.hash)
const file = computed(() => withBase(`/models/${props.model}${isDark.value ? '-dark' : ''}.html`))
const src = ref(`${file.value}#${active.value}`)

watch(file, (next) => {

    src.value = `${next}#${active.value}`

})

// Assigning src would add a browser history entry per tab click; replace() swaps the hash in place.
function show(hash: string) {

    active.value = hash
    frame.value?.contentWindow?.location.replace(`${file.value}#${hash}`)

}
</script>

<template>
    <div class="model-embed model-viewer">
        <div class="model-viewer-bar">
            <span v-if="tabs" class="model-viewer-tabs" role="group" aria-label="Model view">
                <button
                    v-for="view in views"
                    :key="view.hash"
                    type="button"
                    :aria-pressed="view.hash === active"
                    :class="{ on: view.hash === active }"
                    @click="show(view.hash)"
                >{{ view.label }}</button>
            </span>
            <span v-else>{{ label }}</span>
            <span>{{ caption }}</span>
        </div>
        <iframe ref="frame" :src="src" :title="title" loading="lazy"></iframe>
        <slot />
    </div>
</template>
