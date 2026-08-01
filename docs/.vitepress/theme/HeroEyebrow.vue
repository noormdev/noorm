<template>
    <!-- MIT to match LICENSE and every package.json. This said ISC until
         2026-08 and was the most visible license claim on the site. -->
    <div class="hero-eyebrow">V1.0 · MIT · POSTGRES · MYSQL · SQLITE · MSSQL</div>
</template>

<style scoped>
.hero-eyebrow {
    font-family: var(--vp-font-family-mono);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    /* Bronze, not ember: the brand keeps ember for signal (primary CTA, cursor,
       errors) and gives editorial lines like this one the bronze register. */
    color: #6E4A22;
    margin-bottom: 20px;
}

.dark .hero-eyebrow {
    color: #D2A47A;
}
</style>
