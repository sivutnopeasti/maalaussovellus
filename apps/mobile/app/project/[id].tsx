import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Project, Subproject, Phase, Profile } from '../../lib/database.types';
import { ProgressBar } from '../../components/ProgressBar';
import { Button } from '../../components/Button';
import { Colors, Spacing, FontSize, BorderRadius } from '../../constants/theme';

interface SubprojectWithPhases extends Subproject {
  phases: Phase[];
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [subprojects, setSubprojects] = useState<SubprojectWithPhases[]>([]);
  const [contactPerson, setContactPerson] = useState<Profile | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;

    const [projectRes, subprojectRes, membersRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase
        .from('subprojects')
        .select('*, phases(*)')
        .eq('project_id', id)
        .order('sort_order'),
      supabase
        .from('project_members')
        .select('user_id, role')
        .eq('project_id', id)
        .in('role', ['foreman', 'admin'])
        .limit(1),
    ]);

    if (projectRes.data) setProject(projectRes.data);
    if (subprojectRes.data) {
      const sorted = (subprojectRes.data as SubprojectWithPhases[]).map((sp) => ({
        ...sp,
        phases: sp.phases.sort((a, b) => a.sort_order - b.sort_order),
      }));
      setSubprojects(sorted);
    }
    if (membersRes.data && membersRes.data.length > 0) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', membersRes.data[0].user_id)
        .single();
      if (profile) setContactPerson(profile);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const getSubprojectProgress = (phases: Phase[]) => {
    if (phases.length === 0) return 0;
    const completed = phases.filter((p) => p.status === 'completed').length;
    return completed / phases.length;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getDate()}.${d.getMonth() + 1}`;
  };

  if (!project) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Ladataan...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
    >
      <View style={styles.infoCard}>
        <Text style={styles.projectTitle}>Tilaus</Text>
        <Text style={styles.projectDescription}>
          Tästä löydät tilauksesi tarkemmat tiedot.
        </Text>

        <View style={styles.detailsBox}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Tilaustyyppi</Text>
            <Text style={styles.detailValue}>{project.project_type || project.title}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Kalenteroitu aikaväli</Text>
            <Text style={styles.detailValue}>
              {formatDate(project.start_date)} - {formatDate(project.end_date)}
            </Text>
          </View>
        </View>
      </View>

      {contactPerson && (
        <View style={styles.contactSection}>
          <Text style={styles.contactTitle}>Urakan yhteyshenkilö</Text>
          <View style={styles.contactCard}>
            <View style={styles.contactAvatar}>
              <Ionicons name="person" size={24} color={Colors.white} />
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.contactName}>{contactPerson.full_name}</Text>
              {contactPerson.phone ? (
                <Text style={styles.contactDetail}>{contactPerson.phone}</Text>
              ) : null}
              <Text style={styles.contactDetail}>{contactPerson.email}</Text>
            </View>
          </View>
          <View style={styles.contactActions}>
            {contactPerson.phone ? (
              <TouchableOpacity
                style={styles.contactButton}
                onPress={() => Linking.openURL(`tel:${contactPerson.phone}`)}
              >
                <Ionicons name="call" size={18} color={Colors.black} />
                <Text style={styles.contactButtonText}>Soita</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.contactButton, { flex: 1 }]}
              onPress={() => router.push(`/chat/${id}`)}
            >
              <Ionicons name="chatbubble" size={18} color={Colors.black} />
              <Text style={styles.contactButtonText}>Lähetä viesti</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {project.start_date && project.end_date && (
        <View style={styles.timelineSection}>
          <View style={styles.timelineBar}>
            <View
              style={[
                styles.timelineProgress,
                {
                  width: `${Math.min(
                    ((Date.now() - new Date(project.start_date).getTime()) /
                      (new Date(project.end_date).getTime() - new Date(project.start_date).getTime())) *
                      100,
                    100
                  )}%`,
                },
              ]}
            />
          </View>
          <View style={styles.timelineDates}>
            <Text style={styles.timelineDate}>
              {new Date(project.start_date).toLocaleDateString('fi-FI', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
            <Text style={styles.timelineDate}>
              {new Date(project.end_date).toLocaleDateString('fi-FI', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
          </View>
          <Text style={styles.timelineLabel}>Luvattu toimitusväli</Text>
          <Text style={styles.timelineDisclaimer}>
            Kalenteroitu aikaväli voi muuttua useasta eri syystä, tässä ilmoitettu aikataulu on alustava.
          </Text>
        </View>
      )}

      <View style={styles.subprojectsSection}>
        <Text style={styles.sectionTitle}>Alaurakat</Text>

        {subprojects.map((sp) => {
          const progress = getSubprojectProgress(sp.phases);
          return (
            <TouchableOpacity
              key={sp.id}
              style={styles.subprojectCard}
              onPress={() => router.push(`/project/subproject/${sp.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.subprojectInfo}>
                <Text style={styles.subprojectTitle}>{sp.title}</Text>
                <ProgressBar
                  progress={progress}
                  color={progress === 1 ? Colors.success : Colors.primary}
                />
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.textLight} />
            </TouchableOpacity>
          );
        })}

        {subprojects.length === 0 && (
          <Text style={styles.emptyText}>Ei alaurakointeja vielä</Text>
        )}
      </View>

      <View style={styles.actionsSection}>
        <Button
          title="Jokin kysymys? Klikkaa tästä."
          onPress={() => router.push(`/chat/${id}`)}
          variant="primary"
        />
      </View>

      <View style={{ height: Spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  infoCard: {
    backgroundColor: Colors.primary,
    padding: Spacing.lg,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
  },
  projectTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  projectDescription: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  detailsBox: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  detailLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  detailValue: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  timelineSection: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  timelineBar: {
    width: '100%',
    height: 20,
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  timelineProgress: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
  },
  timelineDates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: Spacing.xs,
  },
  timelineDate: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  timelineLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  timelineDisclaimer: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    textAlign: 'center',
  },
  subprojectsSection: {
    padding: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  subprojectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: Spacing.md,
  },
  subprojectInfo: {
    flex: 1,
    gap: Spacing.sm,
  },
  subprojectTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
  actionsSection: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  contactSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  contactTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  contactAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  contactDetail: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  contactActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  contactButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.black,
  },
});
