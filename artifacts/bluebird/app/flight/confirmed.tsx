import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';

export default function FlightConfirmedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const scaleAnim   = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const topPad    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Animated.parallel([
      Animated.spring(scaleAnim,   { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad, paddingBottom: bottomPad + 24 }]}>
      <View style={styles.content}>
        {/* Success icon ring */}
        <Animated.View style={[
          styles.iconRing,
          { backgroundColor: colors.success + '18', opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
        ]}>
          <View style={[styles.iconBg, { backgroundColor: colors.success }]}>
            <Feather name="check" size={44} color="#fff" />
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: opacityAnim, alignItems: 'center', gap: 10 }}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            You're confirmed!
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Your seat has been confirmed. Check your email for boarding details and next steps.
          </Text>
        </Animated.View>

        <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { icon: 'check-circle', label: 'Status',    value: 'Confirmed',                color: colors.success },
            { icon: 'bell',         label: 'Notifications', value: 'Check your app & email', color: colors.foreground },
            { icon: 'briefcase',    label: 'Next step',  value: 'View your trip details',   color: colors.foreground },
          ].map((row, i) => (
            <React.Fragment key={row.label}>
              {i > 0 && <View style={[styles.separator, { backgroundColor: colors.border }]} />}
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Feather name={row.icon as any} size={16} color={row.color} />
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {row.label}
                  </Text>
                </View>
                <Text style={[styles.detailValue, { color: row.color, fontFamily: 'Inter_500Medium' }]}>
                  {row.value}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.replace('/(tabs)/trips')}
          activeOpacity={0.8}
        >
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>View My Trips</Text>
          <Feather name="briefcase" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={() => router.replace('/(tabs)/discover')}
          activeOpacity={0.7}
        >
          <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Back to Discover
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 28 },
  iconRing: {
    width: 140, height: 140, borderRadius: 70,
    justifyContent: 'center', alignItems: 'center',
  },
  iconBg: {
    width: 100, height: 100, borderRadius: 50,
    justifyContent: 'center', alignItems: 'center',
  },
  title:    { fontSize: 28, textAlign: 'center' },
  subtitle: { fontSize: 15, lineHeight: 24, textAlign: 'center' },
  detailCard: {
    width: '100%', borderRadius: 18, borderWidth: 1, overflow: 'hidden',
  },
  detailRow:  {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  detailLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { fontSize: 14 },
  detailValue: { fontSize: 14 },
  separator:   { height: 1 },
  actions: { paddingHorizontal: 24, gap: 12 },
  primaryBtn: {
    height: 56, borderRadius: 999,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 16 },
  secondaryBtn: {
    height: 50, borderRadius: 999, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 15 },
});
