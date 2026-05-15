import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize } from '../constants/theme';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').default;
}

export default function PdfViewerScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title: string }>();
  const router = useRouter();

  const pdfUrl = Platform.OS === 'web'
    ? url
    : `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url || '')}`;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title || 'Dokumentti'}
        </Text>
        <TouchableOpacity
          onPress={() => {
            if (Platform.OS === 'web') {
              window.open(url, '_blank');
            } else {
              const Linking = require('expo-linking');
              Linking.openURL(url);
            }
          }}
          style={styles.externalBtn}
        >
          <Ionicons name="open-outline" size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.viewer}>
        {Platform.OS === 'web' ? (
          <iframe
            src={url}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title={title || 'PDF'}
          />
        ) : WebView ? (
          <WebView
            source={{ uri: pdfUrl }}
            style={{ flex: 1 }}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Ladataan dokumenttia...</Text>
              </View>
            )}
          />
        ) : (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>PDF-lukijaa ei voitu ladata</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingTop: Platform.OS === 'web' ? 12 : 54,
    paddingBottom: 12,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  externalBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewer: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
});
