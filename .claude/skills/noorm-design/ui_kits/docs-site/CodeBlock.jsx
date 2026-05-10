/* eslint-disable */
// CodeBlock.jsx — terminal-styled code block. Used in Hero + DocsPage.
// Highlight tokens: prompt (bronze) · output (mossy) · comment (muted) ·
// keyword (ember-light) · number (bronze-light) · string (cream).

function CodeBlock({ lang = 'bash', file, lines, copyable = true }) {
  const wrap = {
    background: 'var(--ink-950)',
    border: '1px solid color-mix(in oklab, var(--border-strong) 60%, var(--ink-800))',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-md)',
    fontFamily: 'var(--font-mono)',
  };
  const head = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid color-mix(in oklab, var(--border-strong) 60%, var(--ink-800))',
    background: '#161A20',
    fontSize: 11, color: '#7E8590', letterSpacing: '0.04em',
  };
  const pre = {
    margin: 0, padding: '14px 16px', fontSize: 13, lineHeight: 1.65,
    color: '#F2ECE0', overflow: 'auto', maxHeight: 320,
  };
  const colors = {
    prompt: '#916336', out: '#6E8F4E', cmt: '#7E8590',
    key: '#ED7561', num: '#B47A45', str: '#C2C0B5', cur: '#E05742',
  };
  return (
    <div style={wrap}>
      <div style={head}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{lang}</span>
          {file && <><span style={{ color: '#454A59' }}>·</span><span>{file}</span></>}
        </div>
        {copyable && <button style={{
          background: 'transparent', border: 0, color: '#B8B3A8',
          fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          copy
        </button>}
      </div>
      <pre style={pre}>
        {lines.map((line, i) => {
          if (typeof line === 'string') return <div key={i}>{line || '\u00A0'}</div>;
          return (
            <div key={i}>
              {line.map((tok, j) => (
                <span key={j} style={{ color: colors[tok.t] || '#F2ECE0' }}>{tok.v}</span>
              ))}
              {line.cursor && <span style={{ display: 'inline-block', width: 8, height: 14, background: colors.cur, verticalAlign: '-2px', marginLeft: 2, animation: 'noormBlink 1.1s steps(1,end) infinite' }}/>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

window.CodeBlock = CodeBlock;
