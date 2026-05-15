import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';

function RootLayoutNav() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';

    if (!session && !inAuth) {
      router.replace('/(auth)/login');
    } else if (session && inAuth) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="project/[id]"
          options={{
            headerShown: true,
            headerTitle: 'Tilauksen tiedot',
            headerBackTitle: 'Takaisin',
            headerTintColor: Colors.text,
            headerStyle: { backgroundColor: Colors.primary },
          }}
        />
        <Stack.Screen
          name="project/subproject/[id]"
          options={{
            headerShown: true,
            headerTitle: '',
            headerBackTitle: 'Takaisin',
            headerTintColor: Colors.text,
            headerStyle: { backgroundColor: Colors.primary },
          }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{
            headerShown: true,
            headerTitle: 'Chat',
            headerBackTitle: 'Takaisin',
            headerTintColor: Colors.text,
            headerStyle: { backgroundColor: Colors.primary },
          }}
        />
        <Stack.Screen
          name="pdf-viewer"
          options={{ headerShown: false }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
