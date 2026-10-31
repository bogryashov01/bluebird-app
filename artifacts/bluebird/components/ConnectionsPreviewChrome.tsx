import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { CONNECTIONS_PREVIEW_TITLE, DEMO_CONVERSATION_NOTICE } from '@/lib/connectionsPreview';

export function ConnectionsPreviewChrome({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 20 : insets.top;
  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="connections-preview-back"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Feather name="chevron-left" size={22} color={colors.primary} />
          <Text style={[styles.backLabel, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>{CONNECTIONS_PREVIEW_TITLE}</Text>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>{title}</Text>
        <Text style={[styles.notice, { color: colors.mutedForegroundLight }]} testID="connections-preview-notice">
          {DEMO_CONVERSATION_NOTICE}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 8, gap: 4 },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 36 },
  backLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8, marginTop: 4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, letterSpacing: -0.4 },
  notice: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
