<template>
    <div class="hero-stats">
        <span>single binary</span>
        <span class="sep">·</span>
        <span>zero dependencies at runtime</span>
        <span class="sep">·</span>
        <span>type-safe SDK</span>
    </div>
</template>

<style scoped>
.hero-stats {
    font-family: var(--vp-font-family-mono);
    font-size: 0.8125rem;
    color: var(--vp-c-text-3);
    margin-top: 32px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.sep {
    color: var(--vp-c-text-3);
    opacity: 0.5;
}
</style>
