import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  Platform,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export const WELCOME_TOUR_KEY_PREFIX = 'bluebird:welcomeTourSeen:';

export function welcomeTourKey(userId: string) {
  return `${WELCOME_TOUR_KEY_PREFIX}${userId}`;
}

const logoSource = require('@/assets/images/bluebird-logo-white.png');
const heroImage1 = require('@/assets/images/onboarding-runway-golden-hour.jpg');
const heroImage2 = require('@/assets/images/onboarding-cabin-interior.jpg');

const NAVY = '#060B1F';
const NAVY_MID = '#0A1128';
const BLUE = '#1259F2';

type Step = { title: string; caption: string };

type Slide =
  | { key: string; kind: 'photo'; image: number; title: string; body?: string; steps?: Step[] }
  | { key: string; kind: 'dark'; title: string; perks: string[] };

const SLIDES: Slide[] = [
  {
    key: 'access',
    kind: 'photo',
    image: heroImage1,
    title: 'Private Aviation.\nMade Accessible.',
    body: 'Bluebird members get access to Empty Leg flights on private jets — up to 75% off, whenever an aircraft is repositioning empty.',
  },
  {
    key: 'how',
    kind: 'photo',
    image: heroImage2,
    title: 'Browse. Queue. Fly.',
    steps: [
      { title: 'Browse available Empty Legs', caption: 'Discover last-minute repositioning flights' },
      { title: 'Join the queue', caption: 'Request a seat in one tap' },
      { title: 'Fly free when selected', caption: 'Or use a Skip the Line Pass to guarantee it' },
    ],
  },
  {
    key: 'perks',
    kind: 'dark',
    title: 'Membership Has\nIts Privileges.',
    perks: ['Base Membership', 'Plus Membership', 'Skip the Line Passes', 'AI Concierge', 'Referral Rewards'],
  },
];

export default function WelcomeTourScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user } = useAuth();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isLast = index === SLIDES.length - 1;
  const heroHeight = Math.round(height * 0.55);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first && typeof first.index === 'number') setIndex(first.index);
  }).current;

  const finish = async () => {
    if (user?.id) {
      await AsyncStorage.setItem(welcomeTourKey(user.id), '1').catch(() => {});
    }
    // Registration continues into home-airport selection (skip included).
    router.replace('/(auth)/onboarding');
  };

  const next = () => {
    if (isLast) {
      finish();
    } else {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    }
  };

  const activeSlide = SLIDES[index];
  const sheetBg = colors.scheme === 'dark' ? NAVY_MID : '#FFFFFF';
  const sheetText = colors.scheme === 'dark' ? '#FFFFFF' : '#0A1128';
  const sheetMuted = colors.scheme === 'dark' ? '#8896B3' : '#5B6779';
  const containerBg = activeSlide.kind === 'dark' ? NAVY : sheetBg;

  return (
    <View style={[styles.container, { backgroundColor: containerBg }]}>
      <StatusBar style="light" />

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => {
          if (item.kind === 'dark') {
            return (
              <View style={[styles.darkSlide, { width, paddingTop: topPad + 24 }]}>
                {/* Subtle blue wing/streak accent near the top */}
                <View style={styles.streakWrap} pointerEvents="none">
                  <View style={[styles.streak, { width: width * 1.1 }]} />
                  <View style={[styles.streakSoft, { width: width * 0.9 }]} />
                </View>
                <View style={styles.darkContent}>
                  <Text style={styles.darkTitle}>{item.title}</Text>
                  <View style={styles.perksList}>
                    {item.perks.map((perk) => (
                      <View key={perk} style={styles.perkRow}>
                        <Text style={styles.perkPlus}>+</Text>
                        <Text style={styles.perkText}>{perk}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            );
          }
          return (
            <View style={[styles.photoSlide, { width, backgroundColor: sheetBg }]}>
              <View style={{ height: heroHeight, width }}>
                <Image source={item.image} style={styles.heroImage} resizeMode="cover" />
                <View style={styles.heroOverlay} />
                <Image
                  source={logoSource}
                  style={[styles.logo, { top: topPad + 12 }]}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.sheet}>
                <Text style={[styles.sheetTitle, { color: sheetText }]}>{item.title}</Text>
                {item.body ? (
                  <Text style={[styles.sheetBody, { color: sheetMuted }]}>{item.body}</Text>
                ) : null}
                {item.steps ? (
                  <View style={styles.stepsList}>
                    {item.steps.map((step, i) => (
                      <View key={step.title} style={styles.stepRow}>
                        <View style={styles.stepCircle}>
                          <Text style={styles.stepNumber}>{i + 1}</Text>
                        </View>
                        <View style={styles.stepTextWrap}>
                          <Text style={[styles.stepTitle, { color: sheetText }]}>{step.title}</Text>
                          <Text style={[styles.stepCaption, { color: sheetMuted }]}>{step.caption}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          );
        }}
      />

      {/* Skip affordance stays visible over photos and the dark slide */}
      <TouchableOpacity
        onPress={finish}
        hitSlop={12}
        style={[styles.skip, { top: topPad + 14 }]}
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <View style={[styles.footer, { paddingBottom: bottomPad + 16 }]}>
        <TouchableOpacity style={styles.cta} onPress={next} activeOpacity={0.85}>
          <Text style={styles.ctaText}>{isLast ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View
              key={s.key}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i === index
                      ? BLUE
                      : activeSlide.kind === 'dark' || colors.scheme === 'dark'
                        ? 'rgba(255,255,255,0.35)'
                        : 'rgba(10,17,40,0.2)',
                  width: i === index ? 22 : 8,
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  skip: { position: 'absolute', right: 24, zIndex: 10 },
  skipText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 6,
  },

  // Photo-hero slides
  photoSlide: { flex: 1 },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,11,31,0.25)',
  },
  logo: { position: 'absolute', left: 24, width: 120, height: 27 },
  sheet: { flex: 1, paddingHorizontal: 28, paddingTop: 28 },
  sheetTitle: {
    fontSize: 28,
    lineHeight: 36,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
    marginBottom: 14,
  },
  sheetBody: { fontSize: 15, lineHeight: 23, fontFamily: 'Inter_400Regular' },
  stepsList: { marginTop: 6, gap: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(18,89,242,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  stepNumber: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: BLUE },
  stepTextWrap: { flex: 1 },
  stepTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  stepCaption: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_400Regular' },

  // Dark perks slide
  darkSlide: { flex: 1, backgroundColor: NAVY },
  streakWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, overflow: 'hidden' },
  streak: {
    position: 'absolute',
    top: 40,
    left: -30,
    height: 3,
    borderRadius: 3,
    backgroundColor: BLUE,
    opacity: 0.8,
    transform: [{ rotate: '-4deg' }],
  },
  streakSoft: {
    position: 'absolute',
    top: 52,
    left: 10,
    height: 10,
    borderRadius: 10,
    backgroundColor: BLUE,
    opacity: 0.18,
    transform: [{ rotate: '-4deg' }],
  },
  darkContent: { paddingHorizontal: 28, paddingTop: 72 },
  darkTitle: {
    fontSize: 28,
    lineHeight: 36,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
    color: '#FFFFFF',
    marginBottom: 24,
  },
  perksList: { gap: 14 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  perkPlus: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: BLUE, width: 14 },
  perkText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#E6EBF5' },

  // Footer chrome
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24 },
  cta: {
    height: 54,
    borderRadius: 999,
    backgroundColor: BLUE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  dot: { height: 8, borderRadius: 4 },
});
