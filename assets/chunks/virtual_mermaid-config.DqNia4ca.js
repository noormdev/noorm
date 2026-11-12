const e={securityLevel:"loose",startOnLoad:!1,theme:"base",fontFamily:"Geist, ui-sans-serif, system-ui, sans-serif",flowchart:{padding:14,nodeSpacing:44,rankSpacing:52,diagramPadding:8},sequence:{actorMargin:56,messageMargin:36,diagramMarginX:8,diagramMarginY:8},themeVariables:{fontFamily:"Geist, ui-sans-serif, system-ui, sans-serif",fontSize:"14px",textColor:"#808080",lineColor:"#808080"},themeCSS:`
    .node :is(rect, polygon, circle, ellipse, path):not(:is(.row-rect-odd, .row-rect-even, .divider) *), rect.actor, rect.note, .cluster rect, .labelBox {
        stroke: #161A20;
        stroke-width: 2.5px;
        rx: 8px;
        ry: 8px;
        filter: drop-shadow(3px 5px 7px rgba(0, 0, 0, 0.35));
    }
    .node:nth-child(5n+1) :is(rect, polygon, circle, ellipse, path):not(:is(.row-rect-odd, .row-rect-even, .divider) *) { fill: #E05742; }
.node:nth-child(5n+2) :is(rect, polygon, circle, ellipse, path):not(:is(.row-rect-odd, .row-rect-even, .divider) *) { fill: #D2A47A; }
.node:nth-child(5n+3) :is(rect, polygon, circle, ellipse, path):not(:is(.row-rect-odd, .row-rect-even, .divider) *) { fill: #8DB26A; }
.node:nth-child(5n+4) :is(rect, polygon, circle, ellipse, path):not(:is(.row-rect-odd, .row-rect-even, .divider) *) { fill: #6FA0CC; }
.node:nth-child(5n+5) :is(rect, polygon, circle, ellipse, path):not(:is(.row-rect-odd, .row-rect-even, .divider) *) { fill: #F2ECE0; }
    .nodeLabel, .nodeLabel p, .label, .label p, .node .label, .node .label p { color: #161A20; }

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

    rect.actor { fill: #D2A47A; }
    text.actor > tspan, .actor tspan { fill: #161A20; stroke: none; font-weight: 600; }
    .actor-line { stroke: var(--mm-dim); stroke-width: 1.5px; stroke-dasharray: 5 4; }
    .messageText { fill: var(--mm-text); stroke: none; }
    rect.note { fill: #F2ECE0; }
    .noteText, .noteText > tspan { fill: #161A20; stroke: none; }
    .loopText, .loopText > tspan, .labelText, .labelText > tspan { fill: var(--mm-text); stroke: none; }
    .loopLine { stroke: var(--mm-dim); stroke-width: 1.5px; stroke-dasharray: 5 4; }
    .activation0, .activation1, .activation2 { fill: #F2ECE0; stroke: #161A20; }

    .state-start, .state-end circle:last-child { fill: var(--mm-text); stroke: var(--mm-text); filter: none; }
    .end-state-inner { fill: var(--mm-canvas); }

    .row-rect-odd path { fill: #F2ECE0; }
    .row-rect-even path { fill: #E7DFCF; }
    .row-rect-odd path, .row-rect-even path, .divider path { stroke: #161A20; stroke-width: 1.5px; }
`};export{e as default};
