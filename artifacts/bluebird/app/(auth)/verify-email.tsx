import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const colors = useColors();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleContinue = () => {
    router.replace('/(tabs)/discover');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad + 24 }]}>
      <View style={styles.content}>
        <View style={[styles.iconRing, { borderColor: colors.primary + '40' }]}>
          <View style={[styles.iconBg, { backgroundColor: colors.primary }]}>
            <Feather name="mail" size={36} color="#fff" />
          </View>
        </View>

        <Text style={styles.title}>Account created!</Text>
        <Text style={styles.body}>
          Welcome aboard,{'\n'}
          <Text style={styles.email}>{user?.name ?? 'new member'}</Text>
        </Text>
        <Text style={styles.subBody}>
          You can start browsing empty-leg flights right away. Email verification is not required in the demo build.
        </Text>

        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={handleContinue} activeOpacity={0.8}>
          <Text style={styles.primaryBtnText}>Browse Flights</Text>
          <Feather name="arrow-right" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 20 },
  iconRing: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 1,
    justifyContent: 'center', alignItems: 'center', alignSelf: 'center',
  },
  iconBg: {
    width: 88, height: 88, borderRadius: 44,
    justifyContent: 'center', alignItems: 'center',
  },
  title: {
    color: '#FFFFFF', fontSize: 28, fontFamily: 'Inter_700Bold',
    textAlign: 'center', marginTop: 8,
  },
  body: {
    color: '#8896B3', fontSize: 16, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 24,
  },
  email: { color: '#FFFFFF', fontFamily: 'Inter_500Medium' },
  subBody: {
    color: '#8896B3', fontSize: 14, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 22,
  },
  primaryBtn: {
    height: 56, borderRadius: 999,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    marginTop: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
