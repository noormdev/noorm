/* eslint-disable */
// Footer.jsx — minimal three-column footer.

function Footer() {
  const wrap = { padding: '56px 28px 36px', background: 'var(--bg)', borderTop: '1px solid var(--border)' };
  const inner = { maxWidth: '84rem', margin: '0 auto', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 40 };
  const h = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-3)', margin: '0 0 14px' };
  const link = { display: 'block', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--fg-2)', textDecoration: 'none', padding: '4px 0' };
  const bottom = { maxWidth: '84rem', margin: '36px auto 0', paddingTop: 22, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)' };
  return (
    <footer style={wrap}>
      <div style={inner}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--ink-800)', display: 'grid', placeItems: 'center' }}>
              <svg viewBox="0 0 64 64" width="14" height="14"><path d="M14 20 L28 32 L14 44 Z" fill="#E05742"/><path d="M30 20 L44 32 L30 44 Z" fill="#E05742"/></svg>
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg-1)' }}>noorm</span>
          </div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-3)', maxWidth: '32ch', lineHeight: 1.5, margin: 0 }}>Database schema & change manager. SQL-first, ORM-free.</p>
        </div>
        <div>
          <div style={h}>Product</div>
          <a href="#" style={link}>CLI</a>
          <a href="#" style={link}>TUI</a>
          <a href="#" style={link}>SDK</a>
          <a href="#" style={link}>Vault</a>
        </div>
        <div>
          <div style={h}>Docs</div>
          <a href="#" style={link}>Installation</a>
          <a href="#" style={link}>First build</a>
          <a href="#" style={link}>Changes</a>
          <a href="#" style={link}>Stages</a>
        </div>
        <div>
          <div style={h}>Resources</div>
          <a href="#" style={link}>GitHub ↗</a>
          <a href="#" style={link}>npm ↗</a>
          <a href="#" style={link}>Changelog</a>
          <a href="#" style={link}>License (ISC)</a>
        </div>
      </div>
      <div style={bottom}>
        <span>© 2026 noorm</span>
        <span>v0.14.2 · built {new Date().toISOString().slice(0,10)}</span>
      </div>
    </footer>
  );
}

window.Footer = Footer;
