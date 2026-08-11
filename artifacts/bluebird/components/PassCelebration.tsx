import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image, Dimensions, Platform, Pressable } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSpring,
  withSequence, Easing, runOnJS, interpolate,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const IS_WEB = Platform.OS === 'web';
const PARTICLE_COUNT = IS_WEB ? 14 : 22;

// Deterministic pseudo-random so particles don't jump between renders.
function rand(seed: number) {
  const x = Math.sin(seed * 9973.13) * 43758.5453;
  return x - Math.floor(x);
}

type ParticleSpec = {
  key: number;
  x: number;        // horizontal drift target (px from center)
  y: number;        // vertical travel (px, negative = up)
  size: number;
  delay: number;
  duration: number;
  rotate: number;   // degrees
  shape: 'dot' | 'bar';
  colorIndex: number;
};

function Particle({ spec, colors: palette }: { spec: ParticleSpec; colors: string[] }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(spec.delay, withTiming(1, {
      duration: spec.duration,
      easing: Easing.out(Easing.cubic),
    }));
  }, []);

  const style = useAnimatedStyle(() => {
    const progress = t.value;
    // Rise fast, then drift down slightly at the end for a natural arc.
    const ty = interpolate(progress, [0, 0.6, 1], [0, spec.y, spec.y + 60]);
    const opacity = interpolate(progress, [0, 0.1, 0.7, 1], [0, 1, 1, 0]);
    return {
      opacity,
      transform: [
        { translateX: spec.x * progress },
        { translateY: ty },
        { rotate: `${spec.rotate * progress}deg` },
        { scale: interpolate(progress, [0, 0.15, 1], [0.4, 1, 0.85]) },
      ],
    };
  });

  const color = palette[spec.colorIndex % palette.length];
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        spec.shape === 'dot'
          ? { width: spec.size, height: spec.size, borderRadius: spec.size / 2 }
          : { width: spec.size * 0.45, height: spec.size * 1.6, borderRadius: 2 },
        { backgroundColor: color },
        style,
      ]}
    />
  );
}

type Props = {
  /** Called when the celebration finishes (auto or tap-to-skip). */
  onDone: () => void;
};

/**
 * Full-screen "Flight Secured" celebration shown when a Skip the Line Pass
 * wins a seat. Brand-navy backdrop in both modes; degrades to simpler
 * timing animations on web.
 */
export function PassCelebration({ onDone }: Props) {
  const colors = useColors();
  const [finished, setFinished] = useState(false);

  const birdScale = useSharedValue(0.3);
  const birdY = useSharedValue(60);
  const birdOpacity = useSharedValue(0);
  const glow = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(16);
  const overlayOpacity = useSharedValue(1);

  const particles = useMemo<ParticleSpec[]>(() =>
    Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + rand(i) * 0.8;
      const dist = 90 + rand(i + 50) * (SCREEN_W * 0.42);
      return {
        key: i,
        x: Math.cos(angle) * dist,
        y: -Math.abs(Math.sin(angle)) * (110 + rand(i + 100) * 190) - 40,
        size: 7 + rand(i + 200) * 7,
        delay: 550 + rand(i + 300) * 350,
        duration: 1300 + rand(i + 400) * 700,
        rotate: (rand(i + 500) - 0.5) * 520,
        shape: rand(i + 600) > 0.45 ? 'bar' : 'dot',
        colorIndex: i,
      };
    }), []);

  const particlePalette = [colors.primary, colors.paleBlue, colors.paleBlueFaint, colors.textOnBrand];

  const finish = () => {
    if (finished) return;
    setFinished(true);
    onDone();
  };

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Bird flies up + scales in.
    birdOpacity.value = withTiming(1, { duration: 350 });
    birdY.value = withTiming(0, { duration: 700, easing: Easing.out(Easing.back(1.4)) });
    birdScale.value = IS_WEB
      ? withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) })
      : withSequence(
          withSpring(1.12, { damping: 12, stiffness: 140 }),
          withSpring(1, { damping: 14, stiffness: 160 }),
        );
    glow.value = withDelay(300, withTiming(1, { duration: 800, easing: Easing.out(Easing.quad) }));
    // Headline after the burst starts.
    textOpacity.value = withDelay(850, withTiming(1, { duration: 500 }));
    textY.value = withDelay(850, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
    // Second, lighter haptic tap as confetti pops.
    const h = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }, 600);
    // Auto-dissolve into the confirmed content.
    const auto = setTimeout(() => {
      overlayOpacity.value = withTiming(0, { duration: 550, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(finish)();
      });
    }, 3400);
    return () => { clearTimeout(h); clearTimeout(auto); };
  }, []);

  const skip = () => {
    overlayOpacity.value = withTiming(0, { duration: 250 }, (done) => {
      if (done) runOnJS(finish)();
    });
  };

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const birdStyle = useAnimatedStyle(() => ({
    opacity: birdOpacity.value,
    transform: [{ translateY: birdY.value }, { scale: birdScale.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.55,
    transform: [{ scale: 0.6 + glow.value * 0.9 }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));

  if (finished) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.backgroundMid }, overlayStyle]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessibilityLabel="Skip celebration" />
      {/* Particle origin: center, slightly above middle */}
      <View pointerEvents="none" style={styles.particleOrigin}>
        {particles.map((p) => (
          <Particle key={p.key} spec={p} colors={particlePalette} />
        ))}
      </View>

      <View pointerEvents="none" style={styles.center}>
        <View style={styles.birdWrap}>
          <Animated.View style={[styles.glow, { backgroundColor: colors.primary }, glowStyle]} />
          <Animated.Image
            source={require('@/assets/images/bluebird-logo-white.png')}
            style={[styles.bird, birdStyle]}
            resizeMode="contain"
          />
        </View>
        <Animated.View style={[styles.textBlock, textStyle]}>
          <Text style={[styles.headline, { color: colors.textOnBrand }]}>Flight Secured</Text>
          <Text style={[styles.subheadline, { color: colors.mutedOnBrand }]}>
            Your Skip the Line Pass closed the queue and your seat has been confirmed.
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 50, alignItems: 'center', justifyContent: 'center' },
  particleOrigin: {
    position: 'absolute',
    top: SCREEN_H * 0.42,
    left: SCREEN_W / 2,
  },
  particle: { position: 'absolute' },
  center: { alignItems: 'center', paddingHorizontal: 36, gap: 28 },
  birdWrap: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute', width: 140, height: 140, borderRadius: 70,
  },
  bird: { width: 92, height: 92 },
  textBlock: { alignItems: 'center', gap: 10 },
  headline: { fontFamily: 'Inter_700Bold', fontSize: 32, textAlign: 'center', letterSpacing: 0.3 },
  subheadline: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
