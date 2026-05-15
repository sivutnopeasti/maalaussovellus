import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth-context';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Colors, Spacing, FontSize, BorderRadius } from '../../constants/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Virhe', 'Täytä kaikki kentät');
      return;
    }

    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);

    if (error) {
      Alert.alert('Kirjautuminen epäonnistui', 'Tarkista sähköposti ja salasana.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>M</Text>
          </View>
          <Text style={styles.title}>Maalausyritys</Text>
          <Text style={styles.subtitle}>Kirjaudu sisään</Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Sähköposti"
            placeholder="nimi@esimerkki.fi"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <Input
            label="Salasana"
            placeholder="Salasana"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />

          <Button
            title="Kirjaudu sisään"
            onPress={handleLogin}
            loading={loading}
            style={styles.loginButton}
          />

          <TouchableOpacity
            onPress={() => router.push('/(auth)/register')}
            style={styles.registerLink}
          >
            <Text style={styles.registerText}>
              Ei tiliä?{' '}
              <Text style={styles.registerTextBold}>Rekisteröidy</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '700',
    color: Colors.black,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  form: {
    width: '100%',
  },
  loginButton: {
    marginTop: Spacing.sm,
  },
  registerLink: {
    marginTop: Spacing.lg,
    alignItems: 'center',
  },
  registerText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  registerTextBold: {
    fontWeight: '600',
    color: Colors.text,
  },
});
