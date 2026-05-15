import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Colors, Spacing, FontSize, BorderRadius } from '../../constants/theme';

export default function SettingsScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, phone })
      .eq('id', profile.id);

    setSaving(false);

    if (error) {
      Alert.alert('Virhe', 'Tietojen päivitys epäonnistui');
    } else {
      await refreshProfile();
      setEditing(false);
      Alert.alert('Tallennettu', 'Tietosi on päivitetty');
    }
  };

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      if (window.confirm('Haluatko varmasti kirjautua ulos?')) {
        signOut();
      }
    } else {
      Alert.alert('Kirjaudu ulos', 'Haluatko varmasti kirjautua ulos?', [
        { text: 'Peruuta', style: 'cancel' },
        { text: 'Kirjaudu ulos', style: 'destructive', onPress: signOut },
      ]);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileSection}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={40} color={Colors.white} />
        </View>
        <Text style={styles.name}>{profile?.full_name || 'Käyttäjä'}</Text>
        <Text style={styles.email}>{profile?.email}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profiili</Text>

        {editing ? (
          <View style={styles.editForm}>
            <Input
              label="Nimi"
              value={fullName}
              onChangeText={setFullName}
            />
            <Input
              label="Puhelinnumero"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <View style={styles.editActions}>
              <Button
                title="Peruuta"
                onPress={() => {
                  setEditing(false);
                  setFullName(profile?.full_name ?? '');
                  setPhone(profile?.phone ?? '');
                }}
                variant="outline"
                style={{ flex: 1 }}
              />
              <Button
                title="Tallenna"
                onPress={handleSave}
                loading={saving}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <>
            <SettingRow
              icon="person-outline"
              label="Nimi"
              value={profile?.full_name || '-'}
            />
            <SettingRow
              icon="call-outline"
              label="Puhelin"
              value={profile?.phone || '-'}
            />
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setEditing(true)}
            >
              <Text style={styles.editButtonText}>Muokkaa profiilia</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ilmoitukset</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Ionicons name="notifications-outline" size={20} color={Colors.text} />
            <Text style={styles.settingLabel}>Push-ilmoitukset</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={setNotificationsEnabled}
            trackColor={{ false: Colors.border, true: Colors.primaryDark }}
            thumbColor={Colors.white}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tietoa sovelluksesta</Text>
        <SettingRow icon="information-circle-outline" label="Versio" value="1.0.0" />
      </View>

      <View style={styles.logoutSection}>
        <Button
          title="Kirjaudu ulos"
          onPress={handleSignOut}
          variant="outline"
        />
      </View>

      <View style={{ height: Spacing.xxl }} />
    </ScrollView>
  );
}

function SettingRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Ionicons name={icon} size={20} color={Colors.text} />
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    backgroundColor: Colors.primary,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  name: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  email: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  section: {
    padding: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  settingLabel: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  settingValue: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  editButton: {
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  editForm: {
    gap: Spacing.xs,
  },
  editActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  logoutSection: {
    paddingHorizontal: Spacing.lg,
  },
});
