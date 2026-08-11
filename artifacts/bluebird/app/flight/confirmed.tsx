import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform, Alert, Share,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';

function computeArrival(departureTime?: string, duration?: string): string {
  if (!departureTime || !duration) return '';
  const [depH, depM] = departureTime.split(':').map(Number);
  const hours = duration.match(/(\d+)h/);
  const mins = duration.match(/(\d+)m/);
  const totalMins = depH * 60 + depM
    + (hours ? parseInt(hours[1]) * 60 : 0)
    + (mins ? parseInt(mins[1]) : 0);
  const arrH = Math.floor(totalMins / 60) % 24;
  const arrM = totalMins % 60;
  return `${String(arrH).padStart(2, '0')}:${String(arrM).padStart(2, '0')}`;
}

const NEXT_STEPS = [
  'Review your itinerary',
  'Add flight to calendar',
  'Arrive 30 minutes early',
];

// Dark "You're confirmed!" celebration screen — brand navy in both modes.
export default function FlightConfirmedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    from?: string; to?: string; fromCity?: string; toCity?: string;
    departureTime?: string; duration?: string; aircraftType?: string;
    departureDate?: string;
  }>();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const hasRoute = !!params.from && !!params.to;
  const arrival = computeArrival(params.departureTime, params.duration);
  const routeLine = [params.fromCity ?? params.from, params.toCity ?? params.to]
    .filter(Boolean).join(' → ');
  const subtitle = [routeLine, params.aircraftType].filter(Boolean).join(' · ');

  const handleShare = () => {
    Share.share({
      message: hasRoute
        ? `I'm confirmed on a Bluebird flight: ${params.from} → ${params.to}${params.departureDate ? ` on ${params.departureDate}` : ''}! ✈️`
        : "I'm confirmed on a Bluebird flight! ✈️",
    }).catch(() => {});
  };

  const demoAction = (title: string) =>
    Alert.alert(title, 'Demo — this action is not wired to a real service yet.');

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 40, paddingBottom: bottomPad + 110 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Success mark */}
        <Animated.View style={[
          styles.iconRing,
          { backgroundColor: colors.primary + '26', opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
        ]}>
          <View style={[styles.iconBg, { backgroundColor: colors.primary }]}>
            <Feather name="check" size={30} color={colors.primaryForeground} />
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: opacityAnim, alignItems: 'center', gap: 6 }}>
          <Text style={[styles.title, { color: colors.textOnBrand }]}>You're confirmed!</Text>
          {!!subtitle && <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>{subtitle}</Text>}
        </Animated.View>

        {/* Route timeline */}
        {hasRoute && (
          <View style={styles.timeline}>
            <View style={styles.timelineEnd}>
              <Text style={[styles.timelineCode, { color: colors.textOnBrand }]}>{params.from}</Text>
              {!!params.departureTime && (
                <Text style={[styles.timelineTime, { color: colors.mutedOnBrand }]}>{params.departureTime}</Text>
              )}
            </View>
            <View style={styles.timelineCenter}>
              <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
              <View style={[styles.timelineLine, { backgroundColor: colors.textOnBrand + '33' }]} />
              <Feather name="send" size={13} color={colors.mutedOnBrand} style={{ transform: [{ rotate: '45deg' }] }} />
              <View style={[styles.timelineLine, { backgroundColor: colors.textOnBrand + '33' }]} />
              <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
            </View>
            <View style={[styles.timelineEnd, { alignItems: 'flex-end' }]}>
              <Text style={[styles.timelineCode, { color: colors.textOnBrand }]}>{params.to}</Text>
              {!!arrival && <Text style={[styles.timelineTime, { color: colors.mutedOnBrand }]}>{arrival}</Text>}
            </View>
          </View>
        )}

        {/* Next steps */}
        <View style={styles.nextSteps}>
          <Text style={[styles.nextStepsTitle, { color: colors.textOnBrand }]}>Next Steps</Text>
          {NEXT_STEPS.map((step) => (
            <View key={step} style={styles.stepRow}>
              <Feather name="check" size={14} color={colors.primary} />
              <Text style={[styles.stepText, { color: colors.mutedOnBrand }]}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.actionRow}>
          {[
            { label: 'Add to\nCalendar', onPress: () => demoAction('Add to Calendar') },
            { label: 'Itinerary', onPress: () => demoAction('Itinerary') },
            { label: 'Share', onPress: handleShare },
          ].map((a) => (
            <TouchableOpacity
              key={a.label}
              style={[styles.actionBtn, { backgroundColor: colors.textOnBrand + '12' }]}
              onPress={a.onPress}
              activeOpacity={0.8}
            >
              <Text style={[styles.actionText, { color: colors.textOnBrand }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.dismissTo('/(tabs)/trips')}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>View My Trips</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, alignItems: 'center', gap: 26 },
  iconRing: {
    width: 96, height: 96, borderRadius: 48,
    justifyContent: 'center', alignItems: 'center',
  },
  iconBg: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, textAlign: 'center' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  timeline: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 12 },
  timelineEnd: { alignItems: 'flex-start' },
  timelineCode: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  timelineTime: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  timelineCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  timelineLine: { flex: 1, height: 1 },
  timelineDot: { width: 6, height: 6, borderRadius: 3 },
  nextSteps: { alignSelf: 'stretch', gap: 10 },
  nextStepsTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  actionRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  actionBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, textAlign: 'center', lineHeight: 17 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 22, paddingTop: 12,
  },
  primaryBtn: { borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
