import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, Platform, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

const BLUE = '#1259F2';
const DARK_NAVY = '#0A1128';
const LIGHT_BG = '#FFFFFF';
const TITLE_DARK = '#0B1220';
const BODY_GRAY = '#6B7280';

const heroJet = require('@/assets/images/hero-aircraft.jpg');
const heroTurboprop = require('@/assets/images/aircraft-turboprop.jpg');

const SLIDES = [
  { id: '1', kind: 'photo' as const, image: heroJet },
  { id: '2', kind: 'photo' as const, image: heroTurboprop },
  { id: '3', kind: 'dark' as const },
];

const STEPS = [
  { n: 1, label: 'Browse available Empty Legs', sub: 'Discover last-minute repositioning flights' },
  { n: 2, label: 'Join the queue', sub: 'Request a seat in one tap' },
  { n: 3, label: 'Fly free when selected', sub: 'Or use a Skip the Line Pass to guarantee it' },
];

const PERKS = [
  'Base Membership',
  'Plus Membership',
  'Skip the Line Passes',
  'AI Concierge',
  'Referral Rewards',
];

function LogoMark({ color = '#FFFFFF' }: { color?: string }) {
  return (
    <Feather name="send" size={22} color={color} style={{ transform: [{ rotate: '-45deg' }] }} />
  );
}

function WingStreak() {
  return (
    <View style={styles.wingWrap} pointerEvents="none">
      <View style={[styles.wingStreak, { width: '95%', height: 3, opacity: 0.9 }]} />
      <View style={[styles.wingStreak, { width: '75%', height: 2, opacity: 0.5, marginTop: 6 }]} />
      <View style={[styles.wingStreak, { width: '50%', height: 2, opacity: 0.25, marginTop: 6 }]} />
    </View>
  );
}

interface SlideProps {
  item: typeof SLIDES[number];
  width: number;
  topPad: number;
  heroHeight: number;
}

function Slide({ item, width, topPad, heroHeight }: SlideProps) {
  if (item.kind === 'dark') {
    return (
      <View style={[styles.slide, { width, backgroundColor: DARK_NAVY }]}>
        <WingStreak />
        <View style={[styles.darkContent, { paddingTop: topPad + 64 }]}>
          <Text style={styles.darkTitle}>Membership Has{'\n'}Its Privileges.</Text>
          <View style={styles.perksList}>
            {PERKS.map((perk) => (
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

  const isFirst = item.id === '1';
  return (
    <View style={[styles.slide, { width, backgroundColor: LIGHT_BG }]}>
      <View style={[styles.heroWrap, { height: heroHeight }]}>
        <Image source={item.image} style={styles.heroImage} resizeMode="cover" />
        <View style={[styles.logoOverlay, { top: topPad + 12 }]}>
          <LogoMark color={isFirst ? BLUE : BLUE} />
        </View>
      </View>

      <View style={styles.lightContent}>
        {isFirst ? (
          <>
            <Text style={styles.lightTitle}>Private Aviation.{'\n'}Made Accessible.</Text>
            <Text style={styles.lightBody}>
              Bluebird members get access to Empty Leg flights on private jets — up to 75% off,
              whenever an aircraft is repositioning empty.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.lightTitle}>Browse. Queue. Fly.</Text>
            <View style={styles.stepsList}>
              {STEPS.map((step) => (
                <View key={step.n} style={styles.stepRow}>
                  <View style={styles.stepNumBg}>
                    <Text style={styles.stepNum}>{step.n}</Text>
                  </View>
                  <View style={styles.stepText}>
                    <Text style={styles.stepLabel}>{step.label}</Text>
                    <Text style={styles.stepSub}>{step.sub}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const heroHeight = Math.round(screenHeight * 0.44);
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const isDarkSlide = activeIndex === SLIDES.length - 1;

  const goNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
      setActiveIndex(activeIndex + 1);
    } else {
      router.replace('/(tabs)/discover');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDarkSlide ? DARK_NAVY : LIGHT_BG }]}>
      <StatusBar style={isDarkSlide ? 'light' : 'dark'} />

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={({ item }) => <Slide item={item} width={screenWidth} topPad={topPad} heroHeight={heroHeight} />}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        style={styles.flatList}
        extraData={screenWidth}
        getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
      />

      <View style={[styles.footer, { paddingBottom: bottomPad + 20 }]}>
        <TouchableOpacity style={styles.nextButton} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.nextButtonText}>
            {isDarkSlide ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>

        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === activeIndex ? BLUE : isDarkSlide ? '#2B3450' : '#D6DAE3',
                  width: i === activeIndex ? 22 : 7,
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
  container: {
    flex: 1,
  },
  flatList: {
    flex: 1,
  },
  slide: {
    flex: 1,
  },
  heroWrap: {
    width: '100%',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  logoOverlay: {
    position: 'absolute',
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightContent: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 28,
  },
  lightTitle: {
    color: TITLE_DARK,
    fontSize: 30,
    fontFamily: 'Inter_700Bold',
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  lightBody: {
    color: BODY_GRAY,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 23,
    marginTop: 16,
  },
  stepsList: {
    marginTop: 24,
    gap: 20,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  stepNumBg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#E4EBFD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNum: {
    color: BLUE,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  stepText: {
    flex: 1,
    paddingTop: 1,
  },
  stepLabel: {
    color: TITLE_DARK,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  stepSub: {
    color: BODY_GRAY,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  wingWrap: {
    position: 'absolute',
    top: 60,
    right: 0,
    alignItems: 'flex-end',
    width: '100%',
  },
  wingStreak: {
    backgroundColor: BLUE,
    borderRadius: 2,
  },
  darkContent: {
    flex: 1,
    paddingHorizontal: 28,
  },
  darkTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontFamily: 'Inter_700Bold',
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  perksList: {
    marginTop: 28,
    gap: 16,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  perkPlus: {
    color: BLUE,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    width: 18,
    textAlign: 'center',
  },
  perkText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 16,
    alignItems: 'center',
  },
  nextButton: {
    borderRadius: 999,
    height: 54,
    alignSelf: 'stretch',
    backgroundColor: BLUE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  dot: {
    height: 7,
    borderRadius: 4,
  },
});
