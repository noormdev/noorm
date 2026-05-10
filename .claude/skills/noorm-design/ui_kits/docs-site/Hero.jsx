/* eslint-disable */
// Hero.jsx — display headline, lead, CTA pair, terminal demo.

function Hero({ onPrimary, onSecondary }) {
  const wrap = { padding: '72px 28px 80px', background: 'var(--bg)' };
  const inner = { maxWidth: '84rem', margin: '0 auto', display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 56, alignItems: 'center' };
  const eyebrow = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 18 };
  const h1 = { fontFamily: 'var(--font-sans)', fontSize: 'clamp(48px, 5.4vw, 76px)', fontWeight: 600, lineHeight: 1.02, letterSpacing: '-0.035em', color: 'var(--fg-1)', margin: '0 0 22px' };
  const lead = { fontFamily: 'var(--font-sans)', fontSize: 19, lineHeight: 1.5, color: 'var(--fg-2)', margin: '0 0 32px', maxWidth: '34ch' };
  const ctas = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' };
  const btnP = { padding: '12px 18px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 0, fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };
  const btnS = { padding: '12px 16px', borderRadius: 8, background: 'transparent', color: 'var(--fg-1)', border: '1px solid var(--border-strong)', fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };
  const meta = { marginTop: 28, display: 'flex', gap: 22, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', letterSpacing: '0.02em' };

  const lines = [
    [{ t: 'cmt', v: '# Install (no sudo)' }],
    [{ t: 'prompt', v: '$ ' }, { t: 'str', v: 'curl -fsSL ' }, { t: 'key', v: 'https://noorm.dev/install.sh' }, { t: 'str', v: ' | sh' }],
    '',
    [{ t: 'prompt', v: '$ ' }, { v: 'noorm run build' }],
    [{ t: 'out', v: '  ✓ Executed 1 file' }],
    [{ t: 'out', v: '  ✓ Schema in sync with ' }, { t: 'key', v: 'dev' }],
    '',
    { 0: 0, cursor: true, map(){ return [] } },
  ];
  // last line uses cursor flag
  lines[7] = Object.assign([{ t: 'prompt', v: '$ ' }, { v: 'noorm change ff' }], { cursor: true });

  return (
    <section style={wrap}>
      <div style={inner}>
        <div>
          <div style={eyebrow}>v0.14 · ISC · postgres · mysql · sqlite</div>
          <h1 style={h1}>Write SQL.<br/>Skip the ORM.</h1>
          <p style={lead}>noorm is a CLI for SQL-first database development. Define your schema as files; deploy it to any environment.</p>
          <div style={ctas}>
            <button style={btnP} onClick={onPrimary}>
              Get started
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <button style={btnS} onClick={onSecondary}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
              View on GitHub
            </button>
          </div>
          <div style={meta}>
            <span>1.9 MB binary</span>
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            <span>zero dependencies at runtime</span>
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            <span>type-safe SDK</span>
          </div>
        </div>
        <div>
          <CodeBlock lang="bash" file="install.sh" lines={lines} />
        </div>
      </div>
    </section>
  );
}

window.Hero = Hero;
