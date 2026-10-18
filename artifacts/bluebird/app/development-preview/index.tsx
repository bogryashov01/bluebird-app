import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import {
  DEVELOPMENT_PREVIEW_PAGES,
  isDevelopmentPreviewEnabled,
  type DevelopmentPreviewPage,
} from '@/lib/developmentPreview';

const PAGE_LABELS: Record<DevelopmentPreviewPage, string> = {
  discover: 'Discover',
  'flight-details': 'Flight Details',
  queue: 'Queue',
  trips: 'Trips',
  membership: 'Membership',
  'skip-line-pass': 'Skip the Line Pass',
  profile: 'Profile',
  notifications: 'Notifications',
  'home-airport': 'Home Airport',
  'payment-methods': 'Payment Methods',
};

const ICONS: Record<DevelopmentPreviewPage, React.ComponentProps<typeof Feather>['name']> = {
  discover: 'send',
  'flight-details': 'navigation',
  queue: 'users',
  trips: 'briefcase',
  membership: 'star',
  'skip-line-pass': 'fast-forward',
  profile: 'user',
  notifications: 'bell',
  'home-airport': 'map-pin',
  'payment-methods': 'credit-card',
};

function openPage(page: DevelopmentPreviewPage) {
  if (page === 'queue') {
    router.push({ pathname: '/queue/dev-preview', params: { state: 'not-joined' } } as any);
  } else if (page === 'membership') {
    router.push({ pathname: '/membership/dev-preview', params: { state: 'non-member' } } as any);
  } else if (page === 'skip-line-pass') {
    router.push({ pathname: '/queue/dev-preview', params: { state: 'pass-non-member' } } as any);
  } else {
    router.push(`/development-preview/show?preview=${page}` as any);
  }
}

export default function DevelopmentPreviewHub() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!isDevelopmentPreviewEnabled(isDev)) return <Redirect href="/" />;

  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom;
  return (
    <View testID="development-preview-hub" style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 18, paddingBottom: bottomPad + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.eyebrow, { color: colors.primary }]}>BLUEBIRD · DEV TOOLS</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Development Preview</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Browse static sample screens and states. Nothing here signs in, loads member data, or changes an account.
        </Text>
        <View style={[styles.banner, { backgroundColor: colors.primary + '16', borderColor: colors.primary + '55' }]}>
          <Feather name="eye" size={17} color={colors.primary} />
          <Text style={[styles.bannerText, { color: colors.primary }]}>DEMO / DEVELOPMENT PREVIEW</Text>
        </View>
        <View style={styles.pageList}>
          {DEVELOPMENT_PREVIEW_PAGES.map((page) => (
            <TouchableOpacity
              key={page}
              testID={`development-preview-open-${page}`}
              accessibilityRole="button"
              onPress={() => openPage(page)}
              activeOpacity={0.75}
              style={[styles.pageCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.primary + '16' }]}>
                <Feather name={ICONS[page]} size={18} color={colors.primary} />
              </View>
              <Text style={[styles.pageLabel, { color: colors.foreground }]}>{PAGE_LABELS[page]}</Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 14 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 29, letterSpacing: -0.6 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: -6 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, borderWidth: 1, padding: 13 },
  bannerText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.35 },
  pageList: { gap: 9, marginTop: 3 },
  pageCard: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 13, borderRadius: 15, borderWidth: 1 },
  iconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pageLabel: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
