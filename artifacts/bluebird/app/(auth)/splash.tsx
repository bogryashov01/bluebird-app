import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function SplashScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }),
      ]),
      Animated.timing(taglineOpacity, { toValue: 1, duration: 600, delay: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      router.replace('/(auth)/onboarding');
    }, 2800);
    return () => clearTimeout(timer);
  }, []);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.content}>
        <Animated.View style={[styles.logoContainer, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
          <View style={[styles.iconWrapper, { backgroundColor: colors.primary }]}>
            <Feather name="send" size={40} color="#FFFFFF" style={{ transform: [{ rotate: '-45deg' }] }} />
          </View>
          <Text style={styles.logoText}>Bluebird</Text>
          <View style={styles.trademark}>
            <Text style={styles.trademarkText}>™</Text>
          </View>
        </Animated.View>

        <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
          Private aviation, redefined.
        </Animated.Text>
      </View>

      <View style={styles.dotsContainer}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: colors.border },
              i === 0 && [styles.dotActive, { backgroundColor: colors.primary }],
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrapper: {
    width: 60,
    height: 60,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  trademark: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  trademarkText: {
    color: '#8896B3',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  tagline: {
    color: '#8896B3',
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.3,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 40,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 20,
  },
});
