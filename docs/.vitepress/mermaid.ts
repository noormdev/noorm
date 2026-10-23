/**
 * Mermaid look for the docs: solid brand-colored nodes with ink borders.
 *
 * Node fills and their ink are fixed in both themes. Connectors, edge labels, and the
 * canvas read --mm-* custom properties set on .vp-doc .mermaid in brand.css, so a theme
 * toggle needs no re-render. Anything that changes label size (font, size) lives here,
 * because Mermaid measures labels with this config. HTML label weight is not set: Mermaid
 * 11 measures it at the default weight, so a heavier one clips.
 */

const INK = '#161A20';
const CREAM = '#F2ECE0';
const FILLS = ['#E05742', '#D2A47A', '#8DB26A', '#6FA0CC', CREAM];

const SHAPE = ':is(rect, polygon, circle, ellipse, path):not(:is(.row-rect-odd, .row-rect-even, .divider) *)';
const NODE = `.node ${SHAPE}`;

const cycle = FILLS.map(
    (fill, i) => `.node:nth-child(${FILLS.length}n+${i + 1}) ${SHAPE} { fill: ${fill}; }`,
).join('\n');

const themeCSS = `
    ${NODE}, rect.actor, rect.note, .cluster rect, .labelBox {
        stroke: ${INK};
        stroke-width: 2.5px;
        rx: 8px;
        ry: 8px;
        filter: drop-shadow(3px 5px 7px rgba(0, 0, 0, 0.35));
    }
    ${cycle}
    .nodeLabel, .nodeLabel p, .label, .label p, .node .label, .node .label p { color: ${INK}; }

    .cluster rect {
        fill: transparent;
        filter: none;
        stroke: var(--mm-dim);
        stroke-width: 1.5px;
        stroke-dasharray: 5 4;
    }
    .cluster-label .nodeLabel, .cluster-label p { color: var(--mm-line); }

    .flowchart-link, .edgePath path, .transition, .messageLine0, .messageLine1 {
        stroke: var(--mm-line);
        stroke-width: 2.5px;
        fill: none;
    }
    /* ER markers scale with the line width (markerUnits=strokeWidth), so keep it thin. */
    .relationshipLine { stroke: var(--mm-line); stroke-width: 1.5px; fill: none; }
    .arrowMarkerPath { fill: var(--mm-line); stroke: var(--mm-line); }
    marker:not([id*="Arrow"]):not([id$="-pointEnd"]):not([id$="-pointStart"]) path {
        fill: none;
        stroke: var(--mm-line);
        stroke-width: 1px;
    }
    marker circle { fill: var(--mm-canvas); stroke: var(--mm-line); stroke-width: 1px; }
    marker:is([id$="-pointEnd"], [id$="-pointStart"]) { overflow: visible; }
    marker[id$="-pointEnd"] .arrowMarkerPath { transform-origin: 10px 5px; transform: translateX(-1px) scale(1.2); }
    marker[id$="-pointStart"] .arrowMarkerPath { transform-origin: 0 5px; transform: translateX(1px) scale(1.2); }

    .edgeLabel, .edgeLabel p, .labelBkg, .edgeLabel span {
        background-color: var(--mm-canvas);
        color: var(--mm-text);
    }
    .edgeLabel rect, .relationshipLabelBox { fill: var(--mm-canvas); opacity: 1; }

    rect.actor { fill: ${FILLS[1]}; }
    text.actor > tspan, .actor tspan { fill: ${INK}; stroke: none; font-weight: 600; }
    .actor-line { stroke: var(--mm-dim); stroke-width: 1.5px; stroke-dasharray: 5 4; }
    .messageText { fill: var(--mm-text); stroke: none; }
    rect.note { fill: ${CREAM}; }
    .noteText, .noteText > tspan { fill: ${INK}; stroke: none; }
    .loopText, .loopText > tspan, .labelText, .labelText > tspan { fill: var(--mm-text); stroke: none; }
    .loopLine { stroke: var(--mm-dim); stroke-width: 1.5px; stroke-dasharray: 5 4; }
    .activation0, .activation1, .activation2 { fill: ${CREAM}; stroke: ${INK}; }

    .state-start, .state-end circle:last-child { fill: var(--mm-text); stroke: var(--mm-text); filter: none; }
    .end-state-inner { fill: var(--mm-canvas); }

    .row-rect-odd path { fill: ${CREAM}; }
    .row-rect-even path { fill: #E7DFCF; }
    .row-rect-odd path, .row-rect-even path, .divider path { stroke: ${INK}; stroke-width: 1.5px; }
`;

export const mermaid = {
    theme: 'base',
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
    flowchart: { padding: 14, nodeSpacing: 44, rankSpacing: 52, diagramPadding: 8 },
    sequence: { actorMargin: 56, messageMargin: 36, diagramMarginX: 8, diagramMarginY: 8 },
    themeVariables: {
        fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
        fontSize: '14px',
        textColor: '#808080',
        lineColor: '#808080',
    },
    themeCSS,
};
