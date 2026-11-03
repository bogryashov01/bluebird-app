import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BluebirdLogo } from '@/components/BluebirdLogo';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import {
  CURRENT_WINNER_BODY,
  CURRENT_WINNER_CONTINUE,
  CURRENT_WINNER_TITLE,
  currentWinnerCountdownLabel,
} from '@/lib/currentWinnerCelebration';

const PARTICLE_COUNT = Platform.OS === 'web' ? 10 : 16;

function particleOffset(index: number): { x: number; y: number; size: number; delay: number } {
  const angle = (index / PARTICLE_COUNT) * Math.PI * 2;
  const distance = 72 + (index % 5) * 16;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance * 0.72,
    size: 6 + (index % 4) * 2,
    delay: 180 + index * 35,
  };
}

/**
 * Production celebration after Skip the Line confirms the current winner.
 * This is separate from the legacy demo flight-win animation.
 * Continue only dismisses this view. It does not use another pass.
 */
export function CurrentWinnerCelebration({
  queueClosesAt,
  onContinue,
}: {
  queueClosesAt: string | null;
  onContinue: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const markScale = useSharedValue(0.72);
  const markOpacity = useSharedValue(0);
  const copyOpacity = useSharedValue(0);
  const particles = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, (_, index) => particleOffset(index)),
    [],
  );

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    markOpacity.value = withTiming(1, { duration: 280 });
    markScale.value = withSpring(1, { damping: 12, stiffness: 140 });
    copyOpacity.value = withDelay(240, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [copyOpacity, markOpacity, markScale]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const copyStyle = useAnimatedStyle(() => ({ opacity: copyOpacity.value }));
  const countdown = currentWinnerCountdownLabel(queueClosesAt, nowMs);

  return (
    <View
      testID="current-winner-celebration"
      accessibilityViewIsModal
      style={[styles.screen, { backgroundColor: colors.offWhite, paddingTop: topPad + 12, paddingBottom: bottomPad + 16 }]}
    >
      <View style={styles.burst} pointerEvents="none">
        {particles.map((particle, index) => (
          <Particle
            key={index}
            particle={particle}
            color={index % 2 === 0 ? colors.primary : colors.paleBlue}
          />
        ))}
      </View>
      <Animated.View style={[styles.markWrap, markStyle]}>
        <View style={[styles.glow, { backgroundColor: colors.primary }]} />
        <BluebirdLogo variant="symbol" size="large" />
      </Animated.View>
      <Animated.View style={[styles.copy, copyStyle]}>
        <Text style={[styles.kicker, { color: colors.primary }]}>SKIP THE LINE</Text>
        <Text testID="current-winner-title" style={[styles.title, { color: colors.textOnSurface }]}>
          {CURRENT_WINNER_TITLE}
        </Text>
        <Text testID="current-winner-body" style={[styles.body, { color: colors.mutedForegroundLight }]}>
          {CURRENT_WINNER_BODY}
        </Text>
        <View style={[styles.countdownCard, { backgroundColor: colors.surface }]}>
          <Text testID="current-winner-countdown" style={[styles.countdown, { color: colors.textOnSurface }]}>
            {countdown}
          </Text>
        </View>
      </Animated.View>
      <View style={styles.footer}>
        <PrimaryButton
          label={CURRENT_WINNER_CONTINUE}
          testID="current-winner-continue"
          onPress={onContinue}
        />
      </View>
    </View>
  );
}

function Particle({
  particle,
  color,
}: {
  particle: { x: number; y: number; size: number; delay: number };
  color: string;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(particle.delay, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [particle.delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - progress.value * 0.35),
    transform: [
      { translateX: particle.x * progress.value },
      { translateY: particle.y * progress.value },
      { scale: 0.4 + progress.value * 0.6 },
    ],
  }));
  return (
    <Animated.View
      style={[
        styles.particle,
        style,
        {
          width: particle.size,
          height: particle.size,
          borderRadius: particle.size / 2,
          backgroundColor: color,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, zIndex: 30, alignItems: 'center', justifyContent: 'space-between' },
  burst: { position: 'absolute', top: '34%', left: '50%', width: 0, height: 0 },
  particle: { position: 'absolute' },
  markWrap: { marginTop: 48, width: 140, height: 140, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 132, height: 132, borderRadius: 66, opacity: 0.16 },
  copy: { alignItems: 'center', paddingHorizontal: 28, gap: 12 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1.1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 32, lineHeight: 38, textAlign: 'center' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  countdownCard: { marginTop: 8, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, minWidth: 240 },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  footer: { alignSelf: 'stretch', paddingHorizontal: 22 },
});
