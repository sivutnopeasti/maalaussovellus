import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const navItems = [
  { path: '/', label: 'Projektit', icon: '📋' },
  { path: '/users', label: 'Käyttäjät', icon: '👥' },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>M</div>
          <span style={styles.logoText}>Maalausyritys</span>
          <span style={styles.logoSubtext}>Hallintapaneeli</span>
        </div>

        <nav style={styles.nav}>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              style={{
                ...styles.navItem,
                ...(location.pathname === item.path ? styles.navItemActive : {}),
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <button onClick={handleSignOut} style={styles.logoutButton}>
          Kirjaudu ulos
        </button>
      </aside>

      <main style={styles.main}>{children}</main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    minHeight: '100vh',
  },
  sidebar: {
    width: 250,
    backgroundColor: '#1a1a1a',
    color: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 16px',
  },
  logo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 32,
    gap: 4,
  },
  logoIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FFD700',
    color: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 8,
  },
  logoText: {
    fontSize: 16,
    fontWeight: 600,
  },
  logoSubtext: {
    fontSize: 12,
    color: '#999',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    borderRadius: 8,
    color: '#ccc',
    fontSize: 14,
    transition: 'background-color 0.2s',
  },
  navItemActive: {
    backgroundColor: '#333',
    color: '#FFD700',
  },
  logoutButton: {
    backgroundColor: 'transparent',
    border: '1px solid #444',
    color: '#ccc',
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 14,
  },
  main: {
    flex: 1,
    padding: 32,
    overflowY: 'auto' as const,
  },
};
