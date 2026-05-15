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

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const router = useRouter();

  const handleRegister = async () => {
    if (!fullName || !email || !password || !confirmPassword) {
      Alert.alert('Virhe', 'Täytä kaikki kentät');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Virhe', 'Salasanat eivät täsmää');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Virhe', 'Salasanan tulee olla vähintään 6 merkkiä');
      return;
    }

    setLoading(true);
    const { error } = await signUp(email.trim(), password, fullName.trim());
    setLoading(false);

    if (error) {
      Alert.alert('Rekisteröinti epäonnistui', error.message);
    } else {
      Alert.alert(
        'Tili luotu!',
        'Voit nyt kirjautua sisään.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
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
          <Text style={styles.title}>Luo tili</Text>
          <Text style={styles.subtitle}>Rekisteröidy palveluun</Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Koko nimi"
            placeholder="Matti Meikäläinen"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

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
            placeholder="Vähintään 6 merkkiä"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <Input
            label="Vahvista salasana"
            placeholder="Salasana uudelleen"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />

          <Button
            title="Rekisteröidy"
            onPress={handleRegister}
            loading={loading}
            style={styles.registerButton}
          />

          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.loginLink}
          >
            <Text style={styles.loginText}>
              Onko sinulla jo tili?{' '}
              <Text style={styles.loginTextBold}>Kirjaudu</Text>
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
  registerButton: {
    marginTop: Spacing.sm,
  },
  loginLink: {
    marginTop: Spacing.lg,
    alignItems: 'center',
  },
  loginText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  loginTextBold: {
    fontWeight: '600',
    color: Colors.text,
  },
});
