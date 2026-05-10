/* eslint-disable */
// FeatureGrid.jsx — four-tile "why noorm?" grid.

const FG_ICONS = {
  ff: '<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>',
  db: '<path d="M4 6c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3z"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
  tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  pkg: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
};

function FeatureGrid() {
  const wrap = { padding: '80px 28px', background: 'var(--bg-raised)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' };
  const inner = { maxWidth: '84rem', margin: '0 auto' };
  const heading = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 8 };
  const h2 = { fontFamily: 'var(--font-sans)', fontSize: 38, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg-1)', margin: '0 0 44px', maxWidth: '20ch' };
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 };
  const tile = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, transition: 'border-color 120ms' };
  const items = [
    { i: FG_ICONS.ff, t: 'Current schema, always', b: 'SQL files define the schema as it exists today. Fresh databases build in seconds.' },
    { i: FG_ICONS.db, t: 'Full relational SQL', b: 'Compound keys, check constraints, triggers, stored procedures. Whatever your DB supports.' },
    { i: FG_ICONS.tools, t: 'Built-in tools', b: 'Schema explorer, SQL terminal, dynamic templates, encrypted secrets. One CLI replaces five tabs.' },
    { i: FG_ICONS.pkg, t: 'Type-safe SDK', b: 'Domain classes — consumers for queries, producers for mutations. One package, every service.' },
  ];
  return (
    <section style={wrap}>
      <div style={inner}>
        <div style={heading}>Why noorm</div>
        <h2 style={h2}>A toolchain that thinks like your database.</h2>
        <div style={grid}>
          {items.map((it, i) => (
            <div key={i} style={tile}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--border-strong)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <span style={{ display: 'inline-flex', width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: it.i }}/>
              </span>
              <h4 style={{ fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--fg-1)', margin: '14px 0 8px' }}>{it.t}</h4>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-2)', margin: 0 }}>{it.b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

window.FeatureGrid = FeatureGrid;
