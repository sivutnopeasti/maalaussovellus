import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  created_at: string;
}

export function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);

  const fetchUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setUsers(data);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const updateRole = async (userId: string, role: string) => {
    await supabase.from('profiles').update({ role }).eq('id', userId);
    fetchUsers();
  };

  const roleLabels: Record<string, string> = {
    customer: 'Asiakas',
    painter: 'Maalari',
    foreman: 'Työnjohtaja',
    admin: 'Ylläpitäjä',
  };

  const roleColor: Record<string, string> = {
    customer: '#2196F3',
    painter: '#FF9800',
    foreman: '#9C27B0',
    admin: '#F44336',
  };

  return (
    <div>
      <h1 style={styles.title}>Käyttäjät</h1>
      <p style={styles.subtitle}>Hallinnoi käyttäjiä ja heidän roolejaan.</p>

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={{ flex: 2 }}>Nimi</span>
          <span style={{ flex: 2 }}>Sähköposti</span>
          <span style={{ flex: 1 }}>Puhelin</span>
          <span style={{ flex: 1 }}>Rooli</span>
          <span style={{ flex: 1 }}>Liittynyt</span>
        </div>
        {users.map((user) => (
          <div key={user.id} style={styles.tableRow}>
            <span style={{ flex: 2, fontWeight: 500 }}>{user.full_name || '-'}</span>
            <span style={{ flex: 2, color: '#666' }}>{user.email}</span>
            <span style={{ flex: 1, color: '#666' }}>{user.phone || '-'}</span>
            <span style={{ flex: 1 }}>
              <select
                value={user.role}
                onChange={(e) => updateRole(user.id, e.target.value)}
                style={{
                  ...styles.roleSelect,
                  color: roleColor[user.role] || '#666',
                }}
              >
                <option value="customer">{roleLabels.customer}</option>
                <option value="painter">{roleLabels.painter}</option>
                <option value="foreman">{roleLabels.foreman}</option>
                <option value="admin">{roleLabels.admin}</option>
              </select>
            </span>
            <span style={{ flex: 1, color: '#999', fontSize: 13 }}>
              {new Date(user.created_at).toLocaleDateString('fi-FI')}
            </span>
          </div>
        ))}
        {users.length === 0 && (
          <div style={styles.empty}>Ei käyttäjiä vielä</div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    color: '#666',
    marginBottom: 24,
  },
  table: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  tableHeader: {
    display: 'flex',
    padding: '12px 20px',
    backgroundColor: '#f9f9f9',
    fontWeight: 600,
    fontSize: 13,
    color: '#666',
    borderBottom: '1px solid #e0e0e0',
  },
  tableRow: {
    display: 'flex',
    padding: '14px 20px',
    alignItems: 'center',
    borderBottom: '1px solid #f0f0f0',
    fontSize: 14,
  },
  roleSelect: {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #e0e0e0',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#fff',
  },
  empty: {
    padding: 40,
    textAlign: 'center',
    color: '#999',
  },
};
