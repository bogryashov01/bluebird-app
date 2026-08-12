import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSpring,
  withSequence, withRepeat, Easing, runOnJS, interpolate, cancelAnimation,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';

const IS_WEB = Platform.OS === 'web';

/** Minimum time (ms) the overlay stays up so it never flickers. */
const MIN_DURATION = IS_WEB ? 1100 : 1400;

// Queue visualization geometry.
const DOT = 14;
const MEMBER = 22;
const GAP = 18;
const QUEUE_DOTS = 5; // dots ahead of the member while waiting
const TRACK_W = QUEUE_DOTS * (DOT + GAP) + MEMBER;

export type ApplyingPassPhase = 'applying' | 'success' | 'error';

type Props = {
  /**
   * 'applying' while the request is in flight; flip to 'success' or 'error'
   * when it settles. The overlay enforces a minimum display duration, plays
   * the matching resolve/dismiss animation, then calls onDone exactly once.
   */
  phase: ApplyingPassPhase;
  onDone: () => void;
};

/**
 * Full-screen "Skip the Line being applied" overlay: a stylized queue with
 * the member's marker pulsing at the back, then leaping to the front on
 * success before dissolving into the confirmed screen. Brand-navy backdrop
 * in both modes (theme tokens only); haptics on native.
 */
export function ApplyingPassOverlay({ phase, onDone }: Props) {
  const colors = useColors();
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(false);
  const shownAtRef = useRef(Date.now());
  const resolvedRef = useRef(false);

  const overlayOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.92);
  // 0 = member at back of the queue, 1 = member at front.
  const memberProgress = useSharedValue(0);
  const memberPulse = useSharedValue(0);
  const shimmer = useSharedValue(0);
  const successGlow = useSharedValue(0);
  const applyingTextOpacity = useSharedValue(1);
  const successTextOpacity = useSharedValue(0);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFinished(true);
    onDone();
  };

  // Enter + waiting loop.
  useEffect(() => {
    shownAtRef.current = Date.now();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    overlayOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    cardScale.value = withSpring(1, { damping: 16, stiffness: 180 });
    // Member marker eagerly nudges forward while we wait.
    memberPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 550, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 550, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    // Shimmer sweeping toward the front of the line.
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
      -1,
    );
  }, []);

  // Resolve / dismiss when the request settles, but never before MIN_DURATION.
  useEffect(() => {
    if (phase === 'applying' || resolvedRef.current) return;
    resolvedRef.current = true;
    const wait = Math.max(0, MIN_DURATION - (Date.now() - shownAtRef.current));

    const timer = setTimeout(() => {
      if (phase === 'error') {
        overlayOpacity.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) }, (done) => {
          if (done) runOnJS(finish)();
        });
        return;
      }
      // Success: stop the waiting loop and leap to the front.
      cancelAnimation(memberPulse);
      cancelAnimation(shimmer);
      memberPulse.value = withTiming(0, { duration: 120 });
      shimmer.value = withTiming(0, { duration: 120 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      memberProgress.value = IS_WEB
        ? withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) })
        : withSpring(1, { damping: 14, stiffness: 120 });
      successGlow.value = withDelay(250, withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) }));
      applyingTextOpacity.value = withTiming(0, { duration: 200 });
      successTextOpacity.value = withDelay(300, withTiming(1, { duration: 350 }));
      // Hold the "front of the line" beat, then dissolve into confirmed.
      overlayOpacity.value = withDelay(1150, withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(finish)();
      }));
    }, wait);
    return () => clearTimeout(timer);
  }, [phase]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: cardScale.value }] }));

  const memberStyle = useAnimatedStyle(() => {
    // Back of the line is the right end; front is x = 0.
    const backX = QUEUE_DOTS * (DOT + GAP);
    const x = interpolate(memberProgress.value, [0, 1], [backX, 0]) - memberPulse.value * 6;
    // A little arc so the leap reads as jumping over the line.
    const y = -Math.sin(memberProgress.value * Math.PI) * 26;
    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { scale: 1 + memberPulse.value * 0.08 + memberProgress.value * 0.15 },
      ],
    };
  });

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 0.2, 0.8, 1], [0, 0.5, 0.5, 0]),
    transform: [{ translateX: interpolate(shimmer.value, [0, 1], [TRACK_W - 40, -20]) }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: successGlow.value * 0.5,
    transform: [{ scale: 0.5 + successGlow.value }],
  }));

  const applyingTextStyle = useAnimatedStyle(() => ({ opacity: applyingTextOpacity.value }));
  const successTextStyle = useAnimatedStyle(() => ({
    opacity: successTextOpacity.value,
    transform: [{ translateY: interpolate(successTextOpacity.value, [0, 1], [8, 0]) }],
  }));

  // Dots dim as the member passes them.
  const dotStyles = Array.from({ length: QUEUE_DOTS }, (_, i) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => {
      const passedAt = 1 - (i + 1) / (QUEUE_DOTS + 1);
      return {
        opacity: interpolate(
          memberProgress.value,
          [Math.max(0, passedAt - 0.08), Math.min(1, passedAt + 0.08)],
          [0.7, 0.25],
          'clamp',
        ),
      };
    }));

  if (finished) return null;

  return (
    <Animated.View
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.backgroundMid }, overlayStyle]}
    >
      <Animated.View style={[styles.center, cardStyle]}>
        <View style={styles.trackWrap}>
          <Animated.View style={[styles.glow, { backgroundColor: colors.primary }, glowStyle]} />
          {/* Front-of-line marker */}
          <View style={[styles.frontFlag, { borderColor: colors.primary + '66' }]} />
          <View style={[styles.track, { width: TRACK_W }]}>
            <Animated.View
              pointerEvents="none"
              style={[styles.shimmer, { backgroundColor: colors.paleBlue }, shimmerStyle]}
            />
            {Array.from({ length: QUEUE_DOTS }, (_, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: colors.textOnBrand, left: (i + 1) * (DOT + GAP) + (MEMBER - DOT) / 2 },
                  dotStyles[i],
                ]}
              />
            ))}
            <Animated.View style={[styles.member, { backgroundColor: colors.primary }, memberStyle]}>
              <View style={[styles.memberInner, { backgroundColor: colors.primaryForeground }]} />
            </Animated.View>
          </View>
        </View>

        <View style={styles.textWrap}>
          <Animated.Text style={[styles.headline, { color: colors.textOnBrand }, applyingTextStyle]}>
            Applying your pass…
          </Animated.Text>
          <Animated.Text style={[styles.headline, styles.successHeadline, { color: colors.textOnBrand }, successTextStyle]}>
            Front of the line
          </Animated.Text>
          <Text style={[styles.subline, { color: colors.mutedOnBrand }]}>
            Skip the Line Pass · moving you to the front
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 60, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: 34, paddingHorizontal: 36 },
  trackWrap: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 120, height: 120, borderRadius: 60, left: -46 },
  frontFlag: {
    position: 'absolute', left: -14, top: -8, bottom: -8, width: 0,
    borderLeftWidth: 2, borderStyle: 'dashed',
  },
  track: { height: 60, justifyContent: 'center' },
  shimmer: { position: 'absolute', width: 46, height: 3, borderRadius: 2, top: 58 },
  dot: {
    position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2,
  },
  member: {
    position: 'absolute', width: MEMBER, height: MEMBER, borderRadius: MEMBER / 2,
    alignItems: 'center', justifyContent: 'center', left: 0,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, shadowOpacity: 0.3, elevation: 4,
  },
  memberInner: { width: 8, height: 8, borderRadius: 4 },
  textWrap: { alignItems: 'center', gap: 10, minHeight: 74 },
  headline: { fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center', letterSpacing: 0.2 },
  successHeadline: { position: 'absolute', top: 0, left: -60, right: -60 },
  subline: { fontFamily: 'Inter_400Regular', fontSize: 13.5, textAlign: 'center', marginTop: 32 },
});
