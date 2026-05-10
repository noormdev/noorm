/* eslint-disable */
// Header.jsx — sticky top bar.
// Renders: mark + wordmark · nav links · search trigger · theme toggle · github.
// Backdrop blur kicks in past 8 px of scroll (handled by App).

const Icon = ({ d, size = 18, stroke = 1.5 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
);

const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
};

function Header({ route, onNavigate, theme, onTheme, scrolled }) {
  const headerStyle = {
    position: 'sticky', top: 0, zIndex: 30,
    background: scrolled ? 'color-mix(in oklab, var(--bg) 78%, transparent)' : 'var(--bg)',
    backdropFilter: scrolled ? 'blur(10px)' : 'none',
    WebkitBackdropFilter: scrolled ? 'blur(10px)' : 'none',
    borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
    transition: 'border-color 180ms ease, background 180ms ease',
  };
  const inner = {
    maxWidth: '84rem', margin: '0 auto', height: 'var(--header-h)',
    display: 'flex', alignItems: 'center', gap: 28, padding: '0 28px',
  };
  const navItem = (href, label) => {
    const active = route === href;
    return (
      <button
        key={href}
        onClick={() => onNavigate(href)}
        style={{
          background: 'none', border: 0, padding: '6px 0', cursor: 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500,
          color: active ? 'var(--fg-1)' : 'var(--fg-2)',
          borderBottom: active ? '2px solid var(--ember-500)' : '2px solid transparent',
          transition: 'color 120ms ease',
        }}
      >{label}</button>
    );
  };
  const iconBtn = (icon, onClick, title) => (
    <button onClick={onClick} title={title} style={{
      width: 34, height: 34, display: 'grid', placeItems: 'center',
      background: 'transparent', border: 0, color: 'var(--fg-2)',
      borderRadius: 6, cursor: 'pointer', transition: 'all 120ms',
    }}
      onMouseOver={e => { e.currentTarget.style.background = 'var(--paper-300)'; e.currentTarget.style.color = 'var(--fg-1)'; }}
      onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-2)'; }}
    ><Icon d={icon} /></button>
  );
  return (
    <header style={headerStyle}>
      <div style={inner}>
        <button onClick={() => onNavigate('home')} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--ink-800)', display: 'grid', placeItems: 'center' }}>
            <svg viewBox="0 0 64 64" width="18" height="18">
              <path d="M14 20 L28 32 L14 44 Z" fill="#E05742"/>
              <path d="M30 20 L44 32 L30 44 Z" fill="#E05742"/>
              <rect x="50" y="20" width="4" height="24" fill="#916336"/>
            </svg>
          </span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg-1)', display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
            noorm<span style={{ display: 'inline-block', width: '0.42em', height: '0.55em', background: 'var(--ember-500)', marginLeft: '0.05em', transform: 'translateY(0.06em)' }}/>
          </span>
        </button>
        <nav style={{ display: 'flex', gap: 22 }}>
          {navItem('home', 'Home')}
          {navItem('docs', 'Docs')}
          {navItem('cli', 'CLI')}
          {navItem('sdk', 'SDK')}
        </nav>
        <div style={{ flex: 1 }}/>
        <button style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '6px 8px 6px 10px', fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--fg-3)',
          cursor: 'pointer', minWidth: 220,
        }}>
          <Icon d={ICONS.search} size={14}/>
          <span style={{ flex: 1, textAlign: 'left' }}>Search docs</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '2px 6px', background: 'var(--paper-300)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--fg-3)' }}>⌘K</span>
        </button>
        {iconBtn(theme === 'dark' ? ICONS.sun : ICONS.moon, onTheme, 'Toggle theme')}
        {iconBtn(ICONS.github, () => {}, 'GitHub')}
      </div>
    </header>
  );
}

window.Header = Header;
window.HeaderIcon = Icon;
window.HeaderICONS = ICONS;
