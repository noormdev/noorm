/* eslint-disable */
// App.jsx — interactive CLI session click-thru.
const { useState } = React;

const SCRIPT = [
  {
    cmd: 'noorm run build',
    out: (
      <>
        <div style={{ color: '#6E8F4E' }}>✓ Executed 4 files</div>
        <div style={{ color: '#6E8F4E' }}>✓ Schema in sync with <span style={{ color: '#ED7561' }}>dev</span></div>
        <div style={{ color: '#7E8590' }}>  14 tables · 3 views · 0.42s</div>
      </>
    ),
  },
  {
    cmd: 'noorm change ff',
    out: (
      <>
        <div style={{ color: '#7E8590' }}>fast-forwarding 2 changes…</div>
        <div style={{ color: '#6E8F4E' }}>✓ 2024-04-add-email/forward.sql</div>
        <div style={{ color: '#6E8F4E' }}>✓ 2024-05-rename-orders/forward.sql</div>
        <div style={{ color: '#6E8F4E' }}>✓ <span style={{ color: '#ED7561' }}>dev</span> caught up</div>
      </>
    ),
  },
  { cmd: 'noorm ui', out: <TUIMenu/> },
];

const SUGGESTIONS = [
  'noorm run build',
  'noorm change ff',
  'noorm ui',
  'clear',
];

function App() {
  const [log, setLog] = useState([
    { cmd: 'curl -fsSL https://noorm.dev/install.sh | sh', out: <div style={{ color: '#6E8F4E' }}>✓ noorm v0.14.2 installed to /usr/local/bin/noorm</div> },
  ]);
  const [draft, setDraft] = useState('');

  const run = (c) => {
    if (c === 'clear') { setLog([]); setDraft(''); return; }
    const match = SCRIPT.find(s => s.cmd === c) || { cmd: c, out: <div style={{ color: '#7E8590' }}>(demo) command not in script — try a suggestion below.</div> };
    setLog(l => [...l, match]);
    setDraft('');
  };

  return (
    <div data-screen-label="01 CLI" style={{ minHeight: '100vh', background: '#0F1216', padding: '60px 32px', display: 'grid', placeItems: 'start center' }}>
      <div style={{ width: 'min(900px, 100%)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7E8590', marginBottom: 14 }}>noorm — interactive demo</div>
        <TerminalFrame title="alex@noormdev — noorm — 100×30">
          <div style={{ padding: '16px 18px', maxHeight: 540, overflow: 'auto' }}>
            {log.map((entry, i) => <Prompt key={i} cmd={entry.cmd} output={entry.out}/>)}
            <div style={{ display: 'flex', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              <span style={{ color: '#4B7398' }}>~/projects/orders</span>
              <span style={{ color: '#916336' }}> ❯ </span>
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) run(draft.trim()); }}
                placeholder="type a command, or pick one below"
                style={{ background: 'transparent', border: 0, outline: 'none', color: '#F2ECE0', fontFamily: 'inherit', fontSize: 'inherit', flex: 1, caretColor: '#E05742' }}
              />
            </div>
          </div>
        </TerminalFrame>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => run(s)} style={{
              fontFamily: 'var(--font-mono)', fontSize: 12,
              background: '#161A20', border: '1px solid #2F3540',
              color: '#F2ECE0', padding: '6px 10px', borderRadius: 6,
              cursor: 'pointer', transition: 'all 120ms',
            }}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#E05742'; e.currentTarget.style.color = '#ED7561'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#2F3540'; e.currentTarget.style.color = '#F2ECE0'; }}
            >{s}</button>
          ))}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#454A59', marginTop: 10 }}>
          tap a suggestion or press <span style={{ color: '#7E8590' }}>↵</span> to run a command. <span style={{ color: '#7E8590' }}>clear</span> empties the log.
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
