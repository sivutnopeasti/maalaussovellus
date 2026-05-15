import { useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setError('Virheellinen sähköposti tai salasana');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoContainer}>
          <div style={styles.logo}>M</div>
          <h1 style={styles.title}>Maalausyritys</h1>
          <p style={styles.subtitle}>Hallintapaneeli</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.field}>
            <label style={styles.label}>Sähköposti</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="admin@yritys.fi"
              required
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Salasana</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="Salasana"
              required
            />
          </div>

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Kirjaudutaan...' : 'Kirjaudu sisään'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 40,
    width: 400,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  logoContainer: {
    textAlign: 'center' as const,
    marginBottom: 32,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#FFD700',
    color: '#000',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    margin: '0 0 4px',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  error: {
    backgroundColor: '#FEE2E2',
    color: '#DC2626',
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 14,
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: 500,
    color: '#333',
  },
  input: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
    outline: 'none',
  },
  button: {
    backgroundColor: '#FFD700',
    color: '#000',
    padding: '12px',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    border: 'none',
    marginTop: 8,
  },
};
