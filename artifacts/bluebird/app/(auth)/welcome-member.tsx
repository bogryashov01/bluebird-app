import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function WelcomeMemberScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user } = useAuth();

  const firstName = user?.name?.split(' ')[0] ?? 'aboard';
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // This screen only follows completed verification — direct/deep-link entry
  // with an unverified account goes back to the verification gate.
  if (user && !user.emailVerified) {
    return <Redirect href="/(auth)/verify-email" />;
  }

  return (
    // backgroundMid is brand navy in BOTH modes — this screen is intentionally dark-branded.
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      <StatusBar style="light" />

      <View style={styles.content}>
        <Feather
          name="send"
          size={44}
          color={colors.primary}
          style={{ transform: [{ rotate: '-45deg' }], marginBottom: 28 }}
        />
        <Text style={[styles.title, { color: colors.textOnBrand }]}>
          Welcome to Bluebird, {firstName}.
        </Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          Your account is ready. Start browsing Empty Legs,{'\n'}join a queue, and fly private for less.
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: bottomPad + 16 }]}>
        <TouchableOpacity
          style={[styles.continueBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.replace('/(tabs)/discover')}
          activeOpacity={0.85}
        >
          <Text style={[styles.continueText, { color: colors.primaryForeground }]}>Continue to Discover</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  title: {
    fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.4,
    textAlign: 'center', marginBottom: 14,
  },
  body: {
    fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21,
    textAlign: 'center',
  },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  continueBtn: { height: 54, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  continueText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
