import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Platform, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

const SLIDES = [
  {
    id: '1',
    icon: 'send' as const,
    title: 'Private Aviation.\nMade Accessible.',
    body: 'Bluebird members get access to Empty Leg flights — repositioning trips at a fraction of normal charter prices.',
  },
  {
    id: '2',
    icon: 'list' as const,
    title: 'Browse.\nQueue. Fly.',
    steps: [
      { n: 1, label: 'Browse available Empty Legs', sub: 'Discover last-minute repositioning flights' },
      { n: 2, label: 'Join the queue', sub: 'Request a seat in one tap' },
      { n: 3, label: 'Fly free when selected', sub: 'Or use a Skip the Line Pass to guarantee it' },
    ],
  },
  {
    id: '3',
    icon: 'star' as const,
    title: 'Membership Has\nIts Privileges.',
    perks: [
      'Base Membership',
      'Plus Membership',
      'Skip the Line Passes',
      'AI Concierge',
      'Referral Rewards',
    ],
  },
];

interface SlideProps {
  item: typeof SLIDES[number];
  width: number;
}

function Slide({ item, width }: SlideProps) {
  const colors = useColors();
  return (
    <View style={[styles.slide, { width }]}>
      <View style={[styles.iconRing, { borderColor: colors.primary + '40' }]}>
        <View style={[styles.iconBg, { backgroundColor: colors.primary }]}>
          <Feather name={item.icon} size={32} color={colors.primaryForeground} style={item.icon === 'send' ? { transform: [{ rotate: '-45deg' }] } : undefined} />
        </View>
      </View>

      <Text style={[styles.slideTitle, { color: colors.textOnBrand }]}>{item.title}</Text>

      {'body' in item && item.body && (
        <Text style={[styles.slideBody, { color: colors.mutedOnBrand }]}>{item.body}</Text>
      )}

      {'steps' in item && item.steps && (
        <View style={styles.stepsList}>
          {item.steps.map((step) => (
            <View key={step.n} style={styles.stepRow}>
              <View style={[styles.stepNumBg, { backgroundColor: colors.primary + '20', borderColor: colors.primary + '40' }]}>
                <Text style={[styles.stepNum, { color: colors.primary }]}>{step.n}</Text>
              </View>
              <View style={styles.stepText}>
                <Text style={[styles.stepLabel, { color: colors.textOnBrand }]}>{step.label}</Text>
                <Text style={[styles.stepSub, { color: colors.mutedOnBrand }]}>{step.sub}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {'perks' in item && item.perks && (
        <View style={styles.perksList}>
          {item.perks.map((perk) => (
            <View key={perk} style={styles.perkRow}>
              <Text style={[styles.perkPlus, { color: colors.primary }]}>+</Text>
              <Text style={[styles.perkText, { color: colors.textOnBrand }]}>{perk}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const goNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
      setActiveIndex(activeIndex + 1);
    } else {
      router.push('/(auth)/sign-in');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad + 24 }]}>
      <View style={styles.topRow}>
        <View style={styles.logoRow}>
          <Feather name="send" size={18} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
          <Text style={[styles.logoLabel, { color: colors.textOnBrand }]}>Bluebird</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')}>
          <Text style={[styles.skipText, { color: colors.mutedOnBrand }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={({ item }) => <Slide item={item} width={screenWidth} />}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        style={styles.flatList}
        extraData={screenWidth}
        getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
      />

      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: i === activeIndex ? colors.primary : colors.border, width: i === activeIndex ? 20 : 6 }]}
            />
          ))}
        </View>

        <TouchableOpacity style={[styles.nextButton, { backgroundColor: colors.primary }]} onPress={goNext} activeOpacity={0.8}>
          <Text style={[styles.nextButtonText, { color: colors.primaryForeground }]}>
            {activeIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          </Text>
          <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>

        {activeIndex === SLIDES.length - 1 && (
          <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} style={styles.signInLink}>
            <Text style={[styles.signInLinkText, { color: colors.mutedOnBrand }]}>Already a member? Sign in</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoLabel: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  skipText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  flatList: {
    flex: 1,
  },
  slide: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 24,
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  iconBg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideTitle: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    lineHeight: 40,
  },
  slideBody: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    lineHeight: 24,
  },
  stepsList: {
    gap: 16,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  stepNumBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNum: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  stepText: {
    flex: 1,
    paddingTop: 4,
  },
  stepLabel: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  stepSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  perksList: {
    gap: 14,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  perkPlus: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    width: 20,
    textAlign: 'center',
  },
  perkText: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
  },
  footer: {
    paddingHorizontal: 24,
    gap: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  nextButton: {
    borderRadius: 999,
    height: 56,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  nextButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  signInLink: {
    alignItems: 'center',
  },
  signInLinkText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});
