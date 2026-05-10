/* eslint-disable */
// App.jsx — top-level click-thru. Owns theme + route.
const { useState, useEffect } = React;

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('noorm-theme') || 'light');
  const [route, setRoute] = useState(() => localStorage.getItem('noorm-route') || 'home');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('noorm-theme', theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('noorm-route', route);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [route]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div data-screen-label={route === 'home' ? '01 Home' : '02 Docs'} style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg-1)' }}>
      <Header
        route={route}
        onNavigate={setRoute}
        theme={theme}
        onTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
        scrolled={scrolled}
      />
      {route === 'home' ? (
        <>
          <Hero onPrimary={() => setRoute('docs')} onSecondary={() => {}} />
          <FeatureGrid />
        </>
      ) : (
        <DocsPage />
      )}
      <Footer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
