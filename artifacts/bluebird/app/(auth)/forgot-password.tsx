import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad + 24 }]}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Feather name="arrow-left" size={20} color={colors.mutedOnBrand} />
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={[styles.iconRing, { borderColor: colors.primary + '40' }]}>
          <View style={[styles.iconBg, { backgroundColor: colors.primary }]}>
            <Feather name="lock" size={32} color={colors.primaryForeground} />
          </View>
        </View>

        <Text style={[styles.title, { color: colors.textOnBrand }]}>Reset your password</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          Password reset isn't available in the demo build yet. Contact Bluebird
          support at{' '}
          <Text style={[styles.link, { color: colors.primary }]}>support@bluebird.app</Text>{' '}
          and we'll help you get back into your account.
        </Text>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 32 },
  backBtn: { marginTop: 8, width: 36, height: 36, justifyContent: 'center' },
  content: { flex: 1, justifyContent: 'center', gap: 20 },
  iconRing: {
    width: 112, height: 112, borderRadius: 56, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center', alignSelf: 'center',
  },
  iconBg: {
    width: 82, height: 82, borderRadius: 41,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', textAlign: 'center', marginTop: 8 },
  body: { fontSize: 15, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 23 },
  link: { fontFamily: 'Inter_500Medium' },
  primaryBtn: {
    height: 54, borderRadius: 999,
    justifyContent: 'center', alignItems: 'center', marginTop: 8,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
