import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, FontSize, BorderRadius } from '../../constants/theme';

interface Project {
  id: string;
  title: string;
  address: string;
}

interface Document {
  id: string;
  project_id: string;
  title: string;
  file_url: string;
  file_type: string;
  status: string;
  created_at: string;
}

export default function DocumentsScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProjects = useCallback(async () => {
    const { data } = await supabase
      .from('projects')
      .select('id, title, address')
      .order('created_at', { ascending: false });
    if (data) setProjects(data);
  }, []);

  const fetchDocuments = useCallback(async (projectId: string) => {
    const { data } = await supabase
      .from('documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (data) setDocuments(data);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (selectedProject) fetchDocuments(selectedProject);
  }, [selectedProject, fetchDocuments]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProjects();
    if (selectedProject) await fetchDocuments(selectedProject);
    setRefreshing(false);
  };

  const openDocument = (doc: Document) => {
    if (!doc.file_url) return;
    router.push({
      pathname: '/pdf-viewer',
      params: { url: doc.file_url, title: doc.title },
    });
  };

  const getDocIcon = (title: string): keyof typeof Ionicons.glyphMap => {
    if (title.toLowerCase().includes('sopimus') || title.toLowerCase().includes('urakkasopimus'))
      return 'document-text';
    if (title.toLowerCase().includes('tarjous')) return 'pricetag';
    if (title.toLowerCase().includes('kartoitus') || title.toLowerCase().includes('raportti'))
      return 'clipboard';
    if (title.toLowerCase().includes('tarkastus')) return 'checkmark-circle';
    return 'document';
  };

  const getDocColor = (title: string) => {
    if (title.toLowerCase().includes('sopimus')) return '#4CAF50';
    if (title.toLowerCase().includes('tarjous')) return '#2196F3';
    if (title.toLowerCase().includes('kartoitus') || title.toLowerCase().includes('raportti'))
      return '#FF9800';
    if (title.toLowerCase().includes('tarkastus')) return '#9C27B0';
    return Colors.textSecondary;
  };

  if (!selectedProject) {
    return (
      <View style={styles.container}>
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Kaikki dokumentit</Text>
          <Text style={styles.headerSubtitle}>
            Valitse urakka, jonka dokumentteja haluat tarkastella.
          </Text>
        </View>

        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.projectItem}
              onPress={() => setSelectedProject(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.projectItemLeft}>
                <Ionicons name="folder" size={20} color={Colors.primary} />
                <View>
                  <Text style={styles.projectTitle}>{item.title}</Text>
                  <Text style={styles.projectAddress}>{item.address}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textLight} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="documents-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>Ei projekteja</Text>
            </View>
          }
        />
      </View>
    );
  }

  const selectedProjectData = projects.find((p) => p.id === selectedProject);

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <TouchableOpacity
          onPress={() => {
            setSelectedProject(null);
            setDocuments([]);
          }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={20} color={Colors.text} />
          <Text style={styles.backText}>Takaisin</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {selectedProjectData?.title}
        </Text>
        <Text style={styles.headerSubtitle}>
          Kaikki urakkaan liittyvät dokumentit
        </Text>
      </View>

      <FlatList
        data={documents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.documentCard}
            onPress={() => openDocument(item)}
            activeOpacity={0.7}
          >
            <View style={[styles.docIconContainer, { backgroundColor: getDocColor(item.title) + '15' }]}>
              <Ionicons name={getDocIcon(item.title)} size={24} color={getDocColor(item.title)} />
            </View>

            <View style={styles.docContent}>
              <Text style={styles.docTitle}>{item.title}</Text>
              <Text style={styles.docDate}>
                {new Date(item.created_at).toLocaleDateString('fi-FI', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            </View>

            <View style={styles.docRight}>
              <View style={[
                styles.pdfBadge,
                { backgroundColor: Colors.error + '15' }
              ]}>
                <Text style={[styles.pdfBadgeText, { color: Colors.error }]}>PDF</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={Colors.textLight} />
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>Ei dokumentteja vielä</Text>
            <Text style={styles.emptySubtext}>
              Urakoitsija lisää dokumentit tähän.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerCard: {
    backgroundColor: Colors.primary,
    padding: Spacing.lg,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
  },
  headerTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  headerSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: Spacing.sm,
  },
  backText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  list: {
    padding: Spacing.lg,
    paddingBottom: 100,
  },
  projectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  projectItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  projectTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  projectAddress: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  documentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  docIconContainer: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  docContent: {
    flex: 1,
  },
  docTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  docDate: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  docRight: {
    alignItems: 'center',
    gap: 6,
  },
  pdfBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pdfBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  empty: {
    alignItems: 'center',
    paddingTop: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textLight,
  },
  emptySubtext: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
});
