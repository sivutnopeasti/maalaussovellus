import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth-context';
import { ChatMessage, Profile } from '../../lib/database.types';
import { Colors, Spacing, FontSize, BorderRadius } from '../../constants/theme';

interface MessageWithSender extends ChatMessage {
  sender?: Profile;
}

export default function ChatScreen() {
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [members, setMembers] = useState<Map<string, Profile>>(new Map());
  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    if (!projectId) return;

    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (data) setMessages(data);
  }, [projectId]);

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;

    const { data: memberData } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId);

    if (memberData) {
      const userIds = memberData.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      if (profiles) {
        const map = new Map<string, Profile>();
        profiles.forEach((p) => map.set(p.id, p));
        setMembers(map);
      }
    }
  }, [projectId]);

  useEffect(() => {
    fetchMessages();
    fetchMembers();
  }, [fetchMessages, fetchMembers]);

  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`chat:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages((prev) => [...prev, newMsg]);
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user || !projectId) return;

    const message = newMessage.trim();
    setNewMessage('');

    await supabase.from('chat_messages').insert({
      project_id: projectId,
      sender_id: user.id,
      content: message,
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getHours().toString().padStart(2, '0')}.${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  };

  const isOwnMessage = (senderId: string) => senderId === user?.id;

  const renderMessage = ({ item, index }: { item: MessageWithSender; index: number }) => {
    const own = isOwnMessage(item.sender_id);
    const sender = members.get(item.sender_id);
    const showSender =
      !own &&
      (index === 0 || messages[index - 1].sender_id !== item.sender_id);

    return (
      <View
        style={[
          styles.messageRow,
          own ? styles.messageRowOwn : styles.messageRowOther,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            own ? styles.bubbleOwn : styles.bubbleOther,
          ]}
        >
          {showSender && (
            <Text style={styles.senderName}>
              {sender?.full_name || 'Tuntematon'}
            </Text>
          )}
          <Text style={styles.messageText}>{item.content}</Text>
          <View style={styles.messageFooter}>
            <Text style={styles.messageTime}>{formatTime(item.created_at)}</Text>
            {own && item.is_read && (
              <Text style={styles.readReceipt}>Luettu</Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>Ei viestejä vielä</Text>
              <Text style={styles.emptySubtext}>
                Aloita keskustelu kirjoittamalla viesti
              </Text>
            </View>
          }
        />

        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.addButton}>
            <Ionicons name="add" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            placeholder="Kirjoita viesti..."
            placeholderTextColor={Colors.textLight}
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !newMessage.trim() && styles.sendButtonDisabled,
            ]}
            onPress={sendMessage}
            disabled={!newMessage.trim()}
          >
            <Ionicons
              name="send"
              size={20}
              color={newMessage.trim() ? Colors.black : Colors.textLight}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  messagesList: {
    padding: Spacing.md,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  messageRow: {
    marginBottom: Spacing.sm,
    maxWidth: '80%',
  },
  messageRowOwn: {
    alignSelf: 'flex-end',
  },
  messageRowOther: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  bubbleOwn: {
    backgroundColor: Colors.chatBubbleOwn,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: Colors.chatBubbleOther,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  senderName: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 4,
  },
  messageText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  messageTime: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  readReceipt: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.white,
  },
  addButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    maxHeight: 100,
    minHeight: 40,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Spacing.xs,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.surface,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.xxl,
  },
  emptyText: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.textLight,
  },
  emptySubtext: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
});
