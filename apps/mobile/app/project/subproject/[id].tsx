import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import { Subproject, Phase } from '../../../lib/database.types';
import { Colors, Spacing, FontSize, BorderRadius } from '../../../constants/theme';

export default function SubprojectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [subproject, setSubproject] = useState<Subproject | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;

    const { data } = await supabase
      .from('subprojects')
      .select('*, phases(*)')
      .eq('id', id)
      .single();

    if (data) {
      const { phases: phaseData, ...sp } = data as Subproject & { phases: Phase[] };
      setSubproject(sp);
      setPhases(phaseData.sort((a, b) => a.sort_order - b.sort_order));
      navigation.setOptions({ headerTitle: sp.title });
    }
  }, [id, navigation]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return Colors.success;
      case 'in_progress':
        return Colors.warning;
      default:
        return Colors.textLight;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Valmis';
      case 'in_progress':
        return 'Käynnissä';
      default:
        return 'Odottaa';
    }
  };

  if (!subproject) {
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
      <View style={styles.header}>
        <Text style={styles.title}>{subproject.title}</Text>
      </View>

      <View style={styles.phasesList}>
        {phases.map((phase, index) => (
          <TouchableOpacity
            key={phase.id}
            style={styles.phaseItem}
            onPress={() =>
              setExpandedPhase(expandedPhase === phase.id ? null : phase.id)
            }
            activeOpacity={0.7}
          >
            <View style={styles.phaseHeader}>
              <Text style={styles.phaseNumber}>{index + 1}.</Text>
              <Text style={styles.phaseTitle}>{phase.title}</Text>
              <View style={styles.phaseStatus}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: getStatusColor(phase.status) },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    { color: getStatusColor(phase.status) },
                  ]}
                >
                  {getStatusLabel(phase.status)}
                </Text>
                <Ionicons
                  name={expandedPhase === phase.id ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={Colors.textLight}
                />
              </View>
            </View>

            {expandedPhase === phase.id && (
              <View style={styles.phaseDetails}>
                <Text style={styles.phaseDetailText}>
                  Tila: {getStatusLabel(phase.status)}
                </Text>
                <Text style={styles.phaseDetailText}>
                  Päivitetty:{' '}
                  {new Date(phase.updated_at).toLocaleDateString('fi-FI', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ))}

        {phases.length === 0 && (
          <Text style={styles.emptyText}>Ei vaiheita vielä</Text>
        )}
      </View>
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
  header: {
    padding: Spacing.lg,
    backgroundColor: Colors.primary,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
  },
  phasesList: {
    padding: Spacing.lg,
  },
  phaseItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: Spacing.md,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  phaseNumber: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginRight: Spacing.sm,
    minWidth: 24,
  },
  phaseTitle: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  phaseStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  phaseDetails: {
    paddingTop: Spacing.sm,
    paddingLeft: 32,
  },
  phaseDetailText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
});
