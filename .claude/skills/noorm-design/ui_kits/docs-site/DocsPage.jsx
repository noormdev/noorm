/* eslint-disable */
// DocsPage.jsx — sidebar nav · article · right-rail TOC · prev/next.
// One concrete page rendered: getting-started/installation.

const SIDEBAR = [
  { h: 'Getting started', items: ['Installation', 'First build', 'Building your SDK'] },
  { h: 'Guide', items: ['SQL files', 'Organization', 'Changes', 'Stages', 'Vault'] },
  { h: 'CLI', items: ['noorm run', 'noorm change', 'noorm config', 'noorm vault'] },
  { h: 'SDK', items: ['Consumers', 'Producers', 'Generated types'] },
];

function DocsPage() {
  const [active, setActive] = React.useState('Installation');
  const wrap = { display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr) 220px', gap: 48, maxWidth: '84rem', margin: '0 auto', padding: '40px 28px 80px', background: 'var(--bg)' };
  const sb = { borderRight: '1px solid var(--border)', paddingRight: 24, position: 'sticky', top: 'calc(var(--header-h) + 16px)', alignSelf: 'start', maxHeight: 'calc(100vh - var(--header-h) - 32px)', overflow: 'auto' };
  const groupH = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-3)', margin: '18px 0 8px' };
  const item = (label) => {
    const on = label === active;
    return (
      <button key={label} onClick={() => setActive(label)} style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: 'transparent', border: 0, padding: '6px 10px',
        borderRadius: 5, marginBottom: 1, cursor: 'pointer',
        fontFamily: 'var(--font-sans)', fontSize: 13.5,
        color: on ? 'var(--fg-1)' : 'var(--fg-2)',
        fontWeight: on ? 500 : 400,
        borderLeft: on ? '2px solid var(--accent)' : '2px solid transparent',
        marginLeft: -10, paddingLeft: 12,
      }}>{label}</button>
    );
  };
  const article = { minWidth: 0 };
  const eyebrow = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 14 };
  const h1 = { fontFamily: 'var(--font-sans)', fontSize: 42, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg-1)', margin: '0 0 12px' };
  const lead = { fontFamily: 'var(--font-sans)', fontSize: 18, lineHeight: 1.55, color: 'var(--fg-2)', margin: '0 0 32px', maxWidth: '60ch' };
  const h2 = { fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg-1)', margin: '36px 0 12px' };
  const p = { fontFamily: 'var(--font-sans)', fontSize: 15.5, lineHeight: 1.7, color: 'var(--fg-2)', margin: '0 0 14px', maxWidth: '64ch' };
  const ic = { fontFamily: 'var(--font-mono)', fontSize: 13, padding: '1px 6px', background: 'var(--code-bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--fg-1)' };
  const callout = { display: 'grid', gridTemplateColumns: '20px 1fr', gap: 10, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', borderLeft: '3px solid #C2873C', background: 'color-mix(in oklab, #C2873C 8%, var(--surface))', fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--fg-1)', lineHeight: 1.55, margin: '20px 0' };
  const toc = { position: 'sticky', top: 'calc(var(--header-h) + 16px)', alignSelf: 'start' };
  const tocH = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-3)', margin: '0 0 10px' };
  const tocLink = (label, on) => (
    <a href="#" style={{
      display: 'block', padding: '4px 0',
      fontFamily: 'var(--font-sans)', fontSize: 13,
      color: on ? 'var(--fg-1)' : 'var(--fg-2)',
      borderLeft: on ? '2px solid var(--accent)' : '2px solid var(--border)',
      paddingLeft: 10, marginLeft: -2, textDecoration: 'none',
    }}>{label}</a>
  );

  const installLines = [
    [{ t: 'cmt', v: '# Install (no sudo)' }],
    [{ t: 'prompt', v: '$ ' }, { v: 'curl -fsSL ' }, { t: 'key', v: 'https://noorm.dev/install.sh' }, { v: ' | sh' }],
    '',
    [{ t: 'cmt', v: '# Or via npm' }],
    [{ t: 'prompt', v: '$ ' }, { v: 'npm install -g ' }, { t: 'str', v: '@noormdev/cli' }],
  ];
  const buildLines = [
    [{ t: 'prompt', v: '$ ' }, { v: 'mkdir -p sql/01_tables' }],
    [{ t: 'prompt', v: '$ ' }, { v: 'echo ' }, { t: 'str', v: '"CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);"' }, { v: ' > sql/01_tables/001_users.sql' }],
    [{ t: 'prompt', v: '$ ' }, { v: 'noorm run build' }],
    [{ t: 'out', v: '  ✓ Executed 1 file' }],
  ];

  return (
    <div style={wrap}>
      <aside style={sb}>
        {SIDEBAR.map(g => (
          <div key={g.h}>
            <div style={groupH}>{g.h}</div>
            {g.items.map(item)}
          </div>
        ))}
      </aside>
      <main style={article}>
        <div style={eyebrow}>Getting started · 01</div>
        <h1 style={h1}>Installation</h1>
        <p style={lead}>Get noorm installed and running in under a minute. The binary is 1.9 MB, depends on nothing at runtime, and works on macOS, Linux, and WSL.</p>
        <CodeBlock lang="bash" file="install.sh" lines={installLines} />
        <div style={callout}>
          <span style={{ marginTop: 1, color: '#C2873C' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>
          </span>
          <div><strong style={{ fontWeight: 600, color: 'var(--fg-1)', marginRight: 6 }}>Corporate network?</strong>If <code style={ic}>noorm.dev</code> is blocked, use the GitHub mirror at <code style={ic}>raw.githubusercontent.com/noormdev/noorm/master/install.sh</code>.</div>
        </div>
        <h2 style={h2}>Verify the install</h2>
        <p style={p}>Confirm the binary is on your PATH and check the version. <code style={ic}>noorm</code> prints help when called without arguments.</p>
        <CodeBlock lang="bash" lines={[
          [{ t: 'prompt', v: '$ ' }, { v: 'noorm --version' }],
          [{ t: 'out', v: '  v0.14.2' }],
        ]}/>
        <h2 style={h2}>Your first schema</h2>
        <p style={p}>Create a folder of SQL files and run <code style={ic}>noorm run build</code>. SQL files are organized into numbered subfolders so noorm executes them in a deterministic order.</p>
        <CodeBlock lang="bash" lines={buildLines}/>
        <p style={p}>That's it — your schema is live. The <a href="#" style={{ color: 'var(--link)', textDecoration: 'underline', textDecorationThickness: 1 }}>next page</a> walks you through evolving an existing database with changes.</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 56, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
          <button style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-2)', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>← Previous</div>
            <div style={{ color: 'var(--fg-1)', marginTop: 2, fontWeight: 500 }}>Why noorm</div>
          </button>
          <button style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-2)', cursor: 'pointer', textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Next →</div>
            <div style={{ color: 'var(--fg-1)', marginTop: 2, fontWeight: 500 }}>First build</div>
          </button>
        </div>
      </main>
      <aside style={toc}>
        <div style={tocH}>On this page</div>
        {tocLink('Installation', true)}
        {tocLink('Verify the install', false)}
        {tocLink('Your first schema', false)}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <a href="#" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-2)', textDecoration: 'none' }}>Edit this page ↗</a>
        </div>
      </aside>
    </div>
  );
}

window.DocsPage = DocsPage;
