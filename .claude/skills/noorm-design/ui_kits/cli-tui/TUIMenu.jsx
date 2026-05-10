/* eslint-disable */
// TUIMenu.jsx — the box-drawing menu shown when running `noorm ui`.
function TUIMenu() {
  const c = { border: '#454A59', label: '#F2ECE0', hint: '#7E8590', key: '#ED7561', bronze: '#B47A45', ok: '#6E8F4E' };
  const Row = ({ k, label, val, status }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', padding: '3px 0' }}>
      <span style={{ color: c.border }}>│ </span>
      <span style={{ color: c.key, fontWeight: 500 }}>[{k}]</span>
      <span style={{ color: c.label, marginLeft: 10, minWidth: 130 }}>{label}</span>
      {val && <span style={{ color: c.bronze, marginLeft: 14 }}>{val}</span>}
      {status && <span style={{ color: c.ok, marginLeft: 'auto', marginRight: 12 }}>{status}</span>}
      <span style={{ color: c.border, marginLeft: 'auto' }}>│</span>
    </div>
  );
  const lineStyle = { color: c.border, lineHeight: 1.6 };
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, color: c.label, padding: '8px 0' }}>
      <div style={lineStyle}>┌─ noorm ui ──────────────────────────────────────────── v0.14.2 ─┐</div>
      <Row k="i" label="Identity" val="alex@noormdev"/>
      <Row k="c" label="Config" val="dev → postgres://localhost/orders" status="● in sync"/>
      <Row k="r" label="Run" val="build · explore · query"/>
      <Row k="s" label="Schema" val="14 tables · 3 views"/>
      <Row k="x" label="Changes" val="2 pending" status="● ready"/>
      <Row k="v" label="Vault" val="6 secrets · encrypted"/>
      <Row k="q" label="Quit"/>
      <div style={lineStyle}>├──────────────────────────────────────────────────────────────────┤</div>
      <div style={{ ...lineStyle, color: c.hint, padding: '3px 14px' }}>│  ↑↓ navigate · ↵ select · esc back · ? help                       │</div>
      <div style={lineStyle}>└──────────────────────────────────────────────────────────────────┘</div>
    </div>
  );
}
window.TUIMenu = TUIMenu;
