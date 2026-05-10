/* eslint-disable */
// TerminalFrame.jsx — macOS-style window chrome.
function TerminalFrame({ title = 'noorm — zsh', children }) {
  const wrap = { background: 'var(--ink-950)', border: '1px solid #2F3540', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-mono)' };
  const bar = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#161A20', borderBottom: '1px solid #2F3540' };
  const lights = { display: 'flex', gap: 8 };
  const dot = (c) => <span style={{ width: 12, height: 12, borderRadius: '50%', background: c, display: 'inline-block' }}/>;
  const ttl = { fontFamily: 'var(--font-mono)', fontSize: 12, color: '#7E8590', letterSpacing: '0.04em' };
  const tabs = { display: 'flex', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#7E8590' };
  return (
    <div style={wrap}>
      <div style={bar}>
        <div style={lights}>{dot('#FF5F57')}{dot('#FEBC2E')}{dot('#28C840')}</div>
        <div style={ttl}>{title}</div>
        <div style={tabs}><span style={{ padding: '2px 8px', background: '#0F1216', borderRadius: 4, color: '#F2ECE0' }}>1</span><span style={{ padding: '2px 8px' }}>+</span></div>
      </div>
      {children}
    </div>
  );
}
window.TerminalFrame = TerminalFrame;
