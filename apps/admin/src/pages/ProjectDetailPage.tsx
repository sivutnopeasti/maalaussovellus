import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const DOCUMENT_TYPES = [
  'Urakkasopimus tiilikaton pesu',
  'Tarjous tiilikaton mekaaniselle puhdistukselle',
  'Tarjous tiilikaton pesulle',
  'Urakkasopimus tiilikaton pinnoitus',
  'Urakkasopimus julkisivun maalaus',
  'Tarjous talon julkisivun maalaukselle',
  'Tarjous tiilikaton pinnoitukselle',
  'Vesikaton kuntokartoitus',
  'Julkisivun kuntokartoitus',
  'Maalipinnan kuntoarvioraportti',
  'Vastaanottotarkastuspöytäkirja',
  'Muu dokumentti',
];

interface Project {
  id: string;
  title: string;
  address: string;
  project_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

interface Subproject {
  id: string;
  title: string;
  sort_order: number;
  phases: Phase[];
}

interface Phase {
  id: string;
  title: string;
  status: string;
  sort_order: number;
}

interface Document {
  id: string;
  title: string;
  file_url: string;
  file_type: string;
  status: string;
  created_at: string;
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [subprojects, setSubprojects] = useState<Subproject[]>([]);
  const [newSubproject, setNewSubproject] = useState('');
  const [newPhase, setNewPhase] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Array<{ user_id: string; role: string; email: string }>>([]);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('customer');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocType, setSelectedDocType] = useState(DOCUMENT_TYPES[0]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    if (!id) return;

    const [projRes, subRes, memRes, docRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('subprojects').select('*, phases(*)').eq('project_id', id).order('sort_order'),
      supabase.from('project_members').select('user_id, role').eq('project_id', id),
      supabase.from('documents').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    ]);

    if (projRes.data) setProject(projRes.data);
    if (subRes.data) {
      setSubprojects(
        (subRes.data as Subproject[]).map((sp) => ({
          ...sp,
          phases: sp.phases.sort((a, b) => a.sort_order - b.sort_order),
        }))
      );
    }
    if (memRes.data) {
      const memberList = [];
      for (const m of memRes.data) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', m.user_id)
          .single();
        memberList.push({ ...m, email: profile?.email || 'tuntematon' });
      }
      setMembers(memberList);
    }
    if (docRes.data) setDocuments(docRes.data);
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const addSubproject = async () => {
    if (!newSubproject.trim() || !id) return;
    await supabase.from('subprojects').insert({
      project_id: id,
      title: newSubproject.trim(),
      sort_order: subprojects.length,
    });
    setNewSubproject('');
    fetchData();
  };

  const addPhase = async (subprojectId: string) => {
    const title = newPhase[subprojectId];
    if (!title?.trim()) return;
    const existing = subprojects.find((s) => s.id === subprojectId);
    await supabase.from('phases').insert({
      subproject_id: subprojectId,
      title: title.trim(),
      sort_order: existing?.phases.length || 0,
    });
    setNewPhase({ ...newPhase, [subprojectId]: '' });
    fetchData();
  };

  const togglePhaseStatus = async (phase: Phase) => {
    const next = phase.status === 'pending' ? 'in_progress' : phase.status === 'in_progress' ? 'completed' : 'pending';
    await supabase.from('phases').update({ status: next }).eq('id', phase.id);
    fetchData();
  };

  const updateProjectStatus = async (status: string) => {
    if (!id) return;
    await supabase.from('projects').update({ status }).eq('id', id);
    fetchData();
  };

  const addMember = async () => {
    if (!newMemberEmail.trim() || !id) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', newMemberEmail.trim())
      .single();

    if (!profile) {
      alert('Käyttäjää ei löydy tällä sähköpostilla');
      return;
    }

    await supabase.from('project_members').insert({
      project_id: id,
      user_id: profile.id,
      role: newMemberRole,
    });
    setNewMemberEmail('');
    fetchData();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    if (file.type !== 'application/pdf') {
      alert('Vain PDF-tiedostot ovat sallittuja');
      return;
    }

    setUploading(true);
    const fileName = `${id}/${Date.now()}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(fileName, file, { contentType: 'application/pdf' });

    if (uploadError) {
      alert('Tiedoston lataus epäonnistui: ' + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(fileName);

    await supabase.from('documents').insert({
      project_id: id,
      title: selectedDocType,
      file_url: urlData.publicUrl,
      file_type: 'pdf',
      status: 'pending',
    });

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    fetchData();
  };

  const deleteDocument = async (docId: string) => {
    if (!confirm('Haluatko poistaa tämän dokumentin?')) return;
    await supabase.from('documents').delete().eq('id', docId);
    fetchData();
  };

  const statusColors: Record<string, string> = {
    pending: '#999',
    in_progress: '#FF9800',
    completed: '#4CAF50',
  };

  const statusLabels: Record<string, string> = {
    pending: 'Odottaa',
    in_progress: 'Käynnissä',
    completed: 'Valmis',
  };

  if (!project) return <div>Ladataan...</div>;

  return (
    <div>
      <Link to="/" style={styles.backLink}>← Takaisin projekteihin</Link>

      <div style={styles.headerCard}>
        <div>
          <h1 style={styles.title}>{project.title}</h1>
          <p style={styles.address}>{project.address}</p>
        </div>
        <div style={styles.statusGroup}>
          <select
            value={project.status}
            onChange={(e) => updateProjectStatus(e.target.value)}
            style={styles.statusSelect}
          >
            <option value="active">Aktiivinen</option>
            <option value="completed">Valmis</option>
            <option value="paused">Tauolla</option>
            <option value="cancelled">Peruttu</option>
          </select>
          <Link to={`/chat/${project.id}`} style={styles.chatLink}>💬 Avaa chat</Link>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Jäsenet</h2>
        <div style={styles.card}>
          {members.map((m) => (
            <div key={m.user_id} style={styles.memberRow}>
              <span>{m.email}</span>
              <span style={styles.roleBadge}>{m.role}</span>
            </div>
          ))}
          <div style={styles.addRow}>
            <input
              style={styles.input}
              placeholder="Käyttäjän sähköposti"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
            />
            <select
              style={styles.select}
              value={newMemberRole}
              onChange={(e) => setNewMemberRole(e.target.value)}
            >
              <option value="customer">Asiakas</option>
              <option value="painter">Maalari</option>
              <option value="foreman">Työnjohtaja</option>
            </select>
            <button style={styles.addButton} onClick={addMember}>Lisää</button>
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Alaurakat ja vaiheet</h2>

        {subprojects.map((sp) => (
          <div key={sp.id} style={styles.card}>
            <h3 style={styles.subprojectTitle}>{sp.title}</h3>

            {sp.phases.map((phase) => (
              <div key={phase.id} style={styles.phaseRow}>
                <button
                  style={{
                    ...styles.phaseStatus,
                    backgroundColor: statusColors[phase.status] + '20',
                    color: statusColors[phase.status],
                    border: `1px solid ${statusColors[phase.status]}40`,
                  }}
                  onClick={() => togglePhaseStatus(phase)}
                >
                  {statusLabels[phase.status]}
                </button>
                <span>{phase.title}</span>
              </div>
            ))}

            <div style={styles.addRow}>
              <input
                style={{ ...styles.input, flex: 1 }}
                placeholder="Uusi vaihe"
                value={newPhase[sp.id] || ''}
                onChange={(e) => setNewPhase({ ...newPhase, [sp.id]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addPhase(sp.id)}
              />
              <button style={styles.addButton} onClick={() => addPhase(sp.id)}>+</button>
            </div>
          </div>
        ))}

        <div style={styles.addRow}>
          <input
            style={{ ...styles.input, flex: 1 }}
            placeholder="Uusi alaurakka"
            value={newSubproject}
            onChange={(e) => setNewSubproject(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSubproject()}
          />
          <button style={styles.addButton} onClick={addSubproject}>
            Lisää alaurakka
          </button>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Asiakirjat</h2>

        <div style={styles.card}>
          <h3 style={{ ...styles.subprojectTitle, marginBottom: 16 }}>Lisää uusi asiakirja</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 250 }}>
              <label style={styles.fieldLabel}>Asiakirjan tyyppi</label>
              <select
                style={styles.docSelect}
                value={selectedDocType}
                onChange={(e) => setSelectedDocType(e.target.value)}
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={styles.fieldLabel}>PDF-tiedosto</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileUpload}
                style={styles.fileInput}
                disabled={uploading}
              />
            </div>
            {uploading && <span style={{ color: '#666', fontSize: 14 }}>Ladataan...</span>}
          </div>
        </div>

        {documents.length > 0 && (
          <div style={styles.card}>
            <h3 style={styles.subprojectTitle}>Lisätyt asiakirjat ({documents.length})</h3>
            {documents.map((doc) => (
              <div key={doc.id} style={styles.docRow}>
                <div style={styles.docIcon}>📄</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.title}</div>
                  <div style={{ color: '#999', fontSize: 12 }}>
                    Lisätty {new Date(doc.created_at).toLocaleDateString('fi-FI')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    ...styles.docStatusBadge,
                    backgroundColor: doc.status === 'signed' ? '#4CAF5020' : '#FF980020',
                    color: doc.status === 'signed' ? '#4CAF50' : '#FF9800',
                  }}>
                    {doc.status === 'signed' ? 'Allekirjoitettu' : 'Odottaa'}
                  </span>
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" style={styles.docViewButton}>
                    Avaa
                  </a>
                  <button style={styles.docDeleteButton} onClick={() => deleteDocument(doc.id)}>
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backLink: {
    color: '#666',
    fontSize: 14,
    marginBottom: 16,
    display: 'inline-block',
  },
  headerCard: {
    backgroundColor: '#FFD700',
    borderRadius: 16,
    padding: 24,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    margin: 0,
  },
  address: {
    color: '#666',
    margin: '4px 0 0',
  },
  statusGroup: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  statusSelect: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #ccc',
    fontSize: 14,
  },
  chatLink: {
    padding: '8px 16px',
    borderRadius: 8,
    backgroundColor: '#fff',
    fontWeight: 600,
    fontSize: 14,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  subprojectTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
  },
  phaseRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid #f0f0f0',
    fontSize: 14,
  },
  phaseStatus: {
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  memberRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #f0f0f0',
    fontSize: 14,
  },
  roleBadge: {
    padding: '2px 10px',
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    fontSize: 12,
    fontWeight: 500,
  },
  addRow: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
  },
  input: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
  },
  select: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#FFD700',
    color: '#000',
    padding: '8px 16px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: '#333',
  },
  docSelect: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
    width: '100%',
  },
  fileInput: {
    padding: '6px',
    fontSize: 14,
  },
  docRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid #f0f0f0',
  },
  docIcon: {
    fontSize: 24,
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docStatusBadge: {
    padding: '4px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  docViewButton: {
    padding: '4px 12px',
    borderRadius: 6,
    backgroundColor: '#FFD700',
    color: '#000',
    fontWeight: 600,
    fontSize: 13,
    textDecoration: 'none',
  },
  docDeleteButton: {
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #e0e0e0',
    backgroundColor: '#fff',
    fontSize: 16,
    cursor: 'pointer',
  },
};
