import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isDark = colors.scheme === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad + 16 }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.content}>
        <View style={[styles.logoCircle, { backgroundColor: colors.primary + '1A' }]}>
          <Feather name="send" size={30} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
        </View>

        <Text style={[styles.title, { color: colors.textOnBrand }]}>Welcome to Bluebird</Text>
        <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
          Sign in or join with your phone number.{'\n'}One code, and you're aboard.
        </Text>

        <TouchableOpacity
          style={[styles.pill, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(auth)/phone')}
          activeOpacity={0.85}
        >
          <View style={styles.pillInner}>
            <Feather name="smartphone" size={17} color={colors.primaryForeground} />
            <Text style={[styles.pillText, { color: colors.primaryForeground }]}>Continue with Phone</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.pill, styles.secondaryPill, { borderColor: colors.primary }]}
          onPress={() => router.push('/(auth)/register')}
          activeOpacity={0.85}
        >
          <View style={styles.pillInner}>
            <Feather name="user-plus" size={17} color={colors.primary} />
            <Text style={[styles.pillText, { color: colors.primary }]}>Register</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={[styles.footerText, { color: colors.mutedOnBrand }]}>
        By continuing you agree to Bluebird's{' '}
        <Text style={[styles.footerLink, { color: colors.primary }]}>Terms of Service</Text> and{' '}
        <Text style={[styles.footerLink, { color: colors.primary }]}>Privacy Policy</Text>.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'stretch' },
  logoCircle: {
    width: 68, height: 68, borderRadius: 34,
    justifyContent: 'center', alignItems: 'center', alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26, fontFamily: 'Inter_700Bold',
    textAlign: 'center', letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 15, fontFamily: 'Inter_400Regular',
    textAlign: 'center', marginTop: 6, marginBottom: 32, lineHeight: 22,
  },
  pill: {
    height: 52, borderRadius: 999,
    justifyContent: 'center', alignItems: 'center',
  },
  secondaryPill: { borderWidth: 1.5, backgroundColor: 'transparent', marginTop: 12 },
  pillInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pillText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  footerText: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 18, paddingHorizontal: 12,
  },
  footerLink: { fontFamily: 'Inter_500Medium' },
});
