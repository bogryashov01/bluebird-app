import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';

function formatDate(d?: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function useQueueCloseCountdown(departureDate?: string, departureTime?: string): string {
  const [remaining, setRemaining] = useState('--:--:--');
  useEffect(() => {
    if (!departureDate || !departureTime) return;
    const compute = () => {
      const [h, m] = departureTime.split(':').map(Number);
      const [y, mo, d] = departureDate.split('-').map(Number);
      const target = new Date(y, mo - 1, d, h, m, 0).getTime();
      const diff = target - Date.now();
      if (diff <= 0) { setRemaining('closed'); return; }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [departureDate, departureTime]);
  return remaining;
}

// "You're in the queue" — success screen shown right after joining.
export default function QueueJoinedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    entryId?: string; position?: string; totalInQueue?: string;
    from?: string; to?: string; fromCity?: string; toCity?: string;
    departureDate?: string; departureTime?: string; duration?: string;
    aircraftType?: string; flightStatus?: string; flightId?: string;
  }>();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const countdown = useQueueCloseCountdown(params.departureDate, params.departureTime);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const statusLabel = params.flightStatus === 'available' ? 'Open'
    : params.flightStatus ? params.flightStatus.charAt(0).toUpperCase() + params.flightStatus.slice(1)
    : 'Open';

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite, paddingTop: topPad, paddingBottom: bottomPad + 16 }]}>
      <View style={styles.content}>
        <Animated.View style={[
          styles.iconRing,
          { backgroundColor: colors.primary + '18', opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
        ]}>
          <View style={[styles.iconBg, { backgroundColor: colors.primary }]}>
            <Feather name="check" size={30} color={colors.primaryForeground} />
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: opacityAnim, alignItems: 'center', gap: 6 }}>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>You're in the queue</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
            {(params.fromCity ?? params.from)} → {(params.toCity ?? params.to)}{params.aircraftType ? ` · ${params.aircraftType}` : ''}
          </Text>
          {!!params.departureDate && (
            <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
              {formatDate(params.departureDate)}{params.departureTime ? ` · ${params.departureTime}` : ''}
            </Text>
          )}
        </Animated.View>

        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.chipValue, { color: colors.textOnSurface }]}>#{params.position ?? '—'}</Text>
            <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>QUEUE POSITION</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.chipValue, { color: statusLabel === 'Open' ? colors.success : colors.textOnSurface }]}>{statusLabel}</Text>
            <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>FLIGHT STATUS</Text>
          </View>
        </View>

        <Text style={[styles.countdown, { color: colors.mutedForegroundLight }]}>
          Queue closes in {countdown}
        </Text>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="View Queue Status" onPress={() => router.replace('/queue/status')} />
        <SecondaryButton
          label="Use Skip the Line Pass Instead"
          onPress={() => router.push({ pathname: '/queue/pass', params })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 22 },
  iconRing: {
    width: 96, height: 96, borderRadius: 48,
    justifyContent: 'center', alignItems: 'center',
  },
  iconBg: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'center' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  chipRow: { flexDirection: 'row', gap: 12 },
  chip: {
    borderRadius: 18, paddingVertical: 16, paddingHorizontal: 22,
    alignItems: 'center', gap: 4, minWidth: 130,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowRadius: 16, shadowOpacity: 0.05, elevation: 2,
  },
  chipValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  chipLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6 },
  countdown: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  footer: { paddingHorizontal: 22, gap: 10 },
});
