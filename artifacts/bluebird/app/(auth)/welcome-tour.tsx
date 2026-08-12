import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export const WELCOME_TOUR_KEY_PREFIX = 'bluebird:welcomeTourSeen:';

export function welcomeTourKey(userId: string) {
  return `${WELCOME_TOUR_KEY_PREFIX}${userId}`;
}

type Slide = {
  key: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    key: 'queues',
    icon: 'users',
    title: 'Join flight queues',
    body: 'Empty-leg flights open a queue. Join the line for the flights you want — when a seat frees up, the front of the line flies.',
  },
  {
    key: 'passes',
    icon: 'zap',
    title: 'Passes & membership tiers',
    body: 'Use Line Passes to jump ahead in a queue, and upgrade your membership tier for better placement and perks.',
  },
  {
    key: 'concierge',
    icon: 'message-circle',
    title: 'Your personal concierge',
    body: 'Questions about a route, a booking, or how anything works? The concierge chat is available any time from the app.',
  },
];

export default function WelcomeTourScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isLast = index === SLIDES.length - 1;

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

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad + 24 }]}>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />

      <View style={styles.topBar}>
        <Text style={[styles.brand, { color: colors.textOnBrand }]}>Welcome to Bluebird</Text>
        <TouchableOpacity onPress={finish} hitSlop={12}>
          <Text style={[styles.skipText, { color: colors.mutedOnBrand }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + '1A' }]}>
              <Feather name={item.icon} size={30} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.textOnBrand }]}>{item.title}</Text>
            <Text style={[styles.body, { color: colors.mutedOnBrand }]}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View
            key={s.key}
            style={[
              styles.dot,
              {
                backgroundColor: i === index ? colors.primary : colors.mutedOnBrand + '55',
                width: i === index ? 22 : 8,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: colors.primary }]}
          onPress={next}
          activeOpacity={0.85}
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
            {isLast ? 'Get Started' : 'Next'}
          </Text>
          <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8,
  },
  brand: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  skipText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  slide: { flex: 1, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center' },
  iconCircle: {
    width: 84, height: 84, borderRadius: 42,
    justifyContent: 'center', alignItems: 'center', marginBottom: 28,
  },
  title: {
    fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5,
    textAlign: 'center', marginBottom: 12,
  },
  body: {
    fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 23,
    textAlign: 'center', maxWidth: 320,
  },
  dots: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 6, marginTop: 8, marginBottom: 24,
  },
  dot: { height: 8, borderRadius: 4 },
  footer: { paddingHorizontal: 24 },
  cta: {
    height: 52, borderRadius: 999, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  ctaText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
