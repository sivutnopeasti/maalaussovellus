import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { Project } from '../../lib/database.types';
import { Colors, Spacing, FontSize, BorderRadius } from '../../constants/theme';

export default function HomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProjects = useCallback(async () => {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setProjects(data);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProjects();
    setRefreshing(false);
  };

  const renderProject = ({ item }: { item: Project }) => (
    <TouchableOpacity
      style={styles.projectCard}
      onPress={() => router.push(`/project/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.projectInfo}>
        <Text style={styles.projectTitle}>{item.title}</Text>
        <View style={styles.addressRow}>
          <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.projectAddress}>{item.address}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.textLight} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Tervetuloa {profile?.full_name || 'käyttäjä'}!
        </Text>
        <TouchableOpacity>
          <Ionicons name="notifications-outline" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Kaikki tilauksesi</Text>
        <Text style={styles.cardSubtitle}>
          Täältä löydät kaikki tilaamasi urakat.
        </Text>
      </View>

      <FlatList
        data={projects}
        renderItem={renderProject}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>Ei tilauksia vielä</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.helpButton}
        activeOpacity={0.8}
      >
        <Text style={styles.helpText}>Kysy mitä vain, vastaamme nopeasti!</Text>
        <View style={styles.helpAvatar}>
          <Ionicons name="person" size={20} color={Colors.white} />
        </View>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.primary,
  },
  greeting: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  card: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
    marginBottom: Spacing.md,
  },
  cardTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  cardSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  projectInfo: {
    flex: 1,
  },
  projectTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 2,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  projectAddress: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  empty: {
    alignItems: 'center',
    paddingTop: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
  },
  helpButton: {
    position: 'absolute',
    bottom: 90,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  helpText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    textAlign: 'center',
  },
  helpAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
