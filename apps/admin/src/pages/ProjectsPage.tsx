import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Project {
  id: string;
  title: string;
  address: string;
  project_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    address: '',
    project_type: '',
    start_date: '',
    end_date: '',
  });

  const fetchProjects = async () => {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setProjects(data);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async () => {
    if (!form.title || !form.address) {
      alert('Täytä vähintään nimi ja osoite');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Kirjaudu sisään uudelleen');
      return;
    }

    const projectId = crypto.randomUUID();

    const { error } = await supabase.from('projects').insert({
      id: projectId,
      title: form.title,
      address: form.address,
      project_type: form.project_type,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    });

    if (error) {
      console.error('Projektin luonti epäonnistui:', error);
      alert('Projektin luonti epäonnistui: ' + error.message);
      return;
    }

    await supabase.from('project_members').insert({
      project_id: projectId,
      user_id: user.id,
      role: 'admin',
    });

    setForm({ title: '', address: '', project_type: '', start_date: '', end_date: '' });
    setShowForm(false);
    fetchProjects();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Haluatko varmasti poistaa tämän projektin?')) return;
    await supabase.from('projects').delete().eq('id', id);
    fetchProjects();
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      active: 'Aktiivinen',
      completed: 'Valmis',
      paused: 'Tauolla',
      cancelled: 'Peruttu',
    };
    return labels[status] || status;
  };

  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: '#4CAF50',
      completed: '#2196F3',
      paused: '#FF9800',
      cancelled: '#F44336',
    };
    return colors[status] || '#999';
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Projektit</h1>
        <button style={styles.addButton} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Peruuta' : '+ Uusi projekti'}
        </button>
      </div>

      {showForm && (
        <div style={styles.formCard}>
          <h2 style={styles.formTitle}>Uusi projekti</h2>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Nimi *</label>
              <input
                style={styles.input}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Esim. Julkisivut"
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Osoite *</label>
              <input
                style={styles.input}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Mannerheimintie 10, Helsinki"
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Tyyppi</label>
              <input
                style={styles.input}
                value={form.project_type}
                onChange={(e) => setForm({ ...form, project_type: e.target.value })}
                placeholder="Esim. Julkisivut"
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Alkupäivä</label>
              <input
                type="date"
                style={styles.input}
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Loppupäivä</label>
              <input
                type="date"
                style={styles.input}
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>
          <button
            style={styles.submitButton}
            onClick={handleCreate}
            disabled={!form.title || !form.address}
          >
            Luo projekti
          </button>
        </div>
      )}

      <div style={styles.table}>
        <div style={styles.tableHeader}>
          <span style={{ flex: 2 }}>Nimi</span>
          <span style={{ flex: 2 }}>Osoite</span>
          <span style={{ flex: 1 }}>Tyyppi</span>
          <span style={{ flex: 1 }}>Tila</span>
          <span style={{ flex: 1 }}>Toiminnot</span>
        </div>
        {projects.map((project) => (
          <div key={project.id} style={styles.tableRow}>
            <span style={{ flex: 2 }}>
              <Link to={`/projects/${project.id}`} style={styles.projectLink}>
                {project.title}
              </Link>
            </span>
            <span style={{ flex: 2, color: '#666' }}>{project.address}</span>
            <span style={{ flex: 1, color: '#666' }}>{project.project_type}</span>
            <span style={{ flex: 1 }}>
              <span
                style={{
                  ...styles.statusBadge,
                  backgroundColor: statusColor(project.status) + '20',
                  color: statusColor(project.status),
                }}
              >
                {statusLabel(project.status)}
              </span>
            </span>
            <span style={{ flex: 1, display: 'flex', gap: 8 }}>
              <Link to={`/chat/${project.id}`} style={styles.actionButton}>
                💬
              </Link>
              <button
                style={styles.deleteButton}
                onClick={() => handleDelete(project.id)}
              >
                🗑️
              </button>
            </span>
          </div>
        ))}
        {projects.length === 0 && (
          <div style={styles.empty}>Ei projekteja. Luo ensimmäinen yllä.</div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
  },
  addButton: {
    backgroundColor: '#FFD700',
    color: '#000',
    padding: '10px 20px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  formTitle: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 16,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#333',
  },
  input: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: '#FFD700',
    color: '#000',
    padding: '10px 24px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
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
  projectLink: {
    fontWeight: 600,
    color: '#1a1a1a',
  },
  statusBadge: {
    padding: '4px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    display: 'inline-block',
  },
  actionButton: {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #e0e0e0',
    backgroundColor: '#fff',
    fontSize: 16,
    display: 'inline-flex',
  },
  deleteButton: {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #e0e0e0',
    backgroundColor: '#fff',
    fontSize: 16,
  },
  empty: {
    padding: 40,
    textAlign: 'center',
    color: '#999',
  },
};
