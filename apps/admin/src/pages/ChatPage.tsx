import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  project_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

export function ChatPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Map<string, Profile>>(new Map());
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const fetchMessages = async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data);
  };

  const fetchMembers = async () => {
    if (!projectId) return;
    const { data: memberData } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId);

    if (memberData) {
      const ids = memberData.map((m) => m.user_id);
      const { data: profiles } = await supabase.from('profiles').select('*').in('id', ids);
      if (profiles) {
        const map = new Map<string, Profile>();
        profiles.forEach((p: Profile) => map.set(p.id, p));
        setMembers(map);
      }
    }
  };

  useEffect(() => {
    fetchMessages();
    fetchMembers();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`admin-chat:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `project_id=eq.${projectId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId || !projectId) return;
    await supabase.from('chat_messages').insert({
      project_id: projectId,
      sender_id: currentUserId,
      content: newMessage.trim(),
    });
    setNewMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Link to={`/projects/${projectId}`} style={styles.backLink}>← Takaisin projektiin</Link>
        <h2 style={styles.title}>Chat</h2>
      </div>

      <div style={styles.messagesContainer}>
        {messages.map((msg) => {
          const isOwn = msg.sender_id === currentUserId;
          const sender = members.get(msg.sender_id);
          return (
            <div
              key={msg.id}
              style={{
                ...styles.messageRow,
                justifyContent: isOwn ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  ...styles.bubble,
                  backgroundColor: isOwn ? '#f5f5f5' : '#fff',
                  borderColor: isOwn ? '#e0e0e0' : '#e0e0e0',
                }}
              >
                {!isOwn && (
                  <div style={styles.senderName}>
                    {sender?.full_name || 'Tuntematon'}
                  </div>
                )}
                <div style={styles.messageText}>{msg.content}</div>
                <div style={styles.messageTime}>{formatTime(msg.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputContainer}>
        <textarea
          style={styles.textInput}
          placeholder="Kirjoita viesti..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button style={styles.sendButton} onClick={sendMessage} disabled={!newMessage.trim()}>
          Lähetä
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 64px)',
  },
  header: {
    marginBottom: 16,
  },
  backLink: {
    color: '#666',
    fontSize: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    margin: '8px 0 0',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    backgroundColor: '#fafafa',
    borderRadius: 12,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  messageRow: {
    display: 'flex',
  },
  bubble: {
    maxWidth: '60%',
    padding: '10px 14px',
    borderRadius: 12,
    border: '1px solid',
  },
  senderName: {
    fontSize: 12,
    fontWeight: 600,
    color: '#333',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 14,
    lineHeight: '1.5',
    color: '#1a1a1a',
  },
  messageTime: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
    textAlign: 'right' as const,
  },
  inputContainer: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
  },
  textInput: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    fontSize: 14,
    resize: 'none' as const,
    fontFamily: 'inherit',
  },
  sendButton: {
    backgroundColor: '#FFD700',
    color: '#000',
    padding: '10px 24px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
  },
};
