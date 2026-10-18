import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  DEVELOPMENT_PREVIEW_STATES,
  isDevelopmentPreviewEnabled,
  parseDevelopmentPreviewPage,
  parseDevelopmentPreviewState,
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

const STATE_LABELS: Record<string, string> = {
  available: 'Available flights',
  empty: 'No flights',
  loading: 'Loading',
  'api-error': 'API error',
  default: 'Sample details',
  queued: 'Queued',
  confirmed: 'Confirmed',
  complete: 'Complete information',
  'missing-information': 'Missing information',
  off: 'Off',
  all: 'All flights',
  specific: 'Specific flights',
};

function selectState(page: DevelopmentPreviewPage, state: string) {
  router.replace(`/development-preview/show?preview=${page}&state=${encodeURIComponent(state)}` as any);
}

function FixtureCard({ children, style }: { children: React.ReactNode; style?: object }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

function DiscoverFixture({ state }: { state: string }) {
  const colors = useColors();
  if (state === 'loading') {
    return <FixtureCard><ActivityIndicator size="large" color={colors.primary} /><Text style={[styles.cardTitle, { color: colors.foreground }]}>Loading flights · DEMO</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Fixture loading state only. No request is running.</Text></FixtureCard>;
  }
  if (state === 'api-error') {
    return <FixtureCard><Feather name="wifi-off" size={30} color={colors.mutedForeground} /><Text style={[styles.cardTitle, { color: colors.foreground }]}>Flights could not load · DEMO</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Sample API error state. Retry is disabled because this preview is offline.</Text></FixtureCard>;
  }
  if (state === 'empty') {
    return <FixtureCard><Feather name="send" size={30} color={colors.mutedForeground} /><Text style={[styles.cardTitle, { color: colors.foreground }]}>No flights match · DEMO</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>This fixture represents an empty Discover list.</Text></FixtureCard>;
  }
  return <FixtureCard><Text style={[styles.route, { color: colors.foreground }]}>DAL → SFO</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Dallas · San Francisco · Citation Latitude</Text><Text style={[styles.badge, { color: colors.primary }]}>AVAILABLE · DEMO</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Saturday, November 7 · 10:00 AM</Text></FixtureCard>;
}

function FlightDetailsFixture() {
  const colors = useColors();
  return <FixtureCard><Text style={[styles.route, { color: colors.foreground }]}>DAL → SFO</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Dallas Love Field to San Francisco</Text><View style={[styles.separator, { backgroundColor: colors.border }]} /><Text style={[styles.row, { color: colors.foreground }]}>Citation Latitude</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Saturday, November 7 · 10:00 AM</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>3 hours · Domestic route</Text><Text style={[styles.disclaimer, { color: colors.destructive }]}>Static sample only. No queue, booking, or payment action is available.</Text></FixtureCard>;
}

function TripsFixture({ state }: { state: string }) {
  const colors = useColors();
  const isQueued = state === 'queued';
  const isConfirmed = state === 'confirmed';
  return <FixtureCard><Text style={[styles.cardTitle, { color: colors.foreground }]}>{isQueued ? 'In queue · DEMO' : isConfirmed ? 'Confirmed trip · DEMO' : 'No upcoming trips · DEMO'}</Text><Text style={[styles.route, { color: colors.foreground }]}>{isQueued || isConfirmed ? 'DAL → SFO' : 'Your trips'}</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{isQueued ? 'Waiting · Position #2' : isConfirmed ? 'Citation Latitude · Saturday, November 7' : 'Browse available flights to see trip activity here.'}</Text><Text style={[styles.disclaimer, { color: colors.destructive }]}>{isConfirmed ? 'Sample trip fixture only. No booking or trip record exists.' : 'Preview fixture only. No account or trip data was loaded.'}</Text></FixtureCard>;
}

function ProfileFixture({ state }: { state: string }) {
  const colors = useColors();
  const missing = state === 'missing-information';
  return <FixtureCard><View style={[styles.avatar, { backgroundColor: colors.primary }]}><Text style={[styles.avatarText, { color: colors.primaryForeground }]}>{missing ? '—' : 'AM'}</Text></View><Text style={[styles.cardTitle, { color: colors.foreground }]}>{missing ? 'Profile needs information · DEMO' : 'Alex Morgan · DEMO'}</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>{missing ? 'Name and email are not available in this sample.' : 'alex.morgan@example.test'}</Text><View style={[styles.separator, { backgroundColor: colors.border }]} /><Text style={[styles.row, { color: colors.foreground }]}>Account</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Personal Information · Payment Methods</Text><Text style={[styles.disclaimer, { color: colors.destructive }]}>Fixture profile only. No account information was read or changed.</Text></FixtureCard>;
}

function NotificationsFixture({ state }: { state: string }) {
  const colors = useColors();
  const options = state === 'off' ? ['Notifications: Off'] : state === 'all'
    ? ['Flight alerts: All flights', 'Queue updates: On']
    : ['Flight alerts: From home and favorite airports', 'Queue updates: On'];
  return <FixtureCard><Text style={[styles.cardTitle, { color: colors.foreground }]}>Notification preferences · DEMO</Text>{options.map((option) => <Text key={option} style={[styles.row, { color: colors.foreground }]}>{option}</Text>)}<Text style={[styles.disclaimer, { color: colors.destructive }]}>Sample preferences only. No notification settings were loaded or saved.</Text></FixtureCard>;
}

function HomeAirportFixture() {
  const colors = useColors();
  return <FixtureCard><Feather name="map-pin" size={30} color={colors.primary} /><Text style={[styles.cardTitle, { color: colors.foreground }]}>Home Airport · DEMO</Text><Text style={[styles.route, { color: colors.foreground }]}>DAL</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Dallas Love Field · Dallas, Texas</Text><Text style={[styles.disclaimer, { color: colors.destructive }]}>Sample selection only. No airport preference was read or saved.</Text></FixtureCard>;
}

function PaymentMethodsFixture() {
  const colors = useColors();
  return <FixtureCard><Feather name="credit-card" size={30} color={colors.primary} /><Text style={[styles.cardTitle, { color: colors.foreground }]}>Your payment methods · DEMO</Text><Text style={[styles.body, { color: colors.mutedForeground }]}>Payment method management is coming soon.</Text><Text style={[styles.disclaimer, { color: colors.destructive }]}>No payment information is displayed, and no payment action is available.</Text></FixtureCard>;
}

export default function DevelopmentPreviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ preview?: string; state?: string }>();
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const page = parseDevelopmentPreviewPage(params.preview);
  if (!isDevelopmentPreviewEnabled(isDev) || !page) return <Redirect href="/development-preview" />;
  const state = parseDevelopmentPreviewState(page, params.state);
  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 20 : insets.bottom;
  const goBack = () => router.replace('/development-preview' as any);

  return (
    <View testID={`development-preview-screen-${page}`} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity testID="development-preview-back-to-hub" onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to preview hub" style={[styles.back, { backgroundColor: colors.card }]}>
          <Feather name="arrow-left" size={19} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{PAGE_LABELS[page]} preview</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{STATE_LABELS[state] ?? state} · DEMO</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.banner, { backgroundColor: colors.primary + '16', borderColor: colors.primary + '55' }]}>
          <Feather name="eye" size={16} color={colors.primary} />
          <Text testID="development-preview-demo-label" style={[styles.bannerText, { color: colors.primary }]}>DEMO / DEVELOPMENT PREVIEW</Text>
        </View>
        <Text style={[styles.fixtureNote, { color: colors.mutedForeground }]}>Fixture-only screen. No signed-in data, Clerk token, or protected API is used.</Text>
        {page === 'discover' ? <DiscoverFixture state={state} />
          : page === 'flight-details' ? <FlightDetailsFixture />
            : page === 'trips' ? <TripsFixture state={state} />
              : page === 'profile' ? <ProfileFixture state={state} />
                : page === 'notifications' ? <NotificationsFixture state={state} />
                  : page === 'home-airport' ? <HomeAirportFixture />
                    : page === 'payment-methods' ? <PaymentMethodsFixture />
                      : null}
        <Text style={[styles.section, { color: colors.mutedForeground }]}>PREVIEW STATES</Text>
        <View style={styles.states}>
          {DEVELOPMENT_PREVIEW_STATES[page].map((candidate) => {
            const selected = candidate === state;
            return (
              <TouchableOpacity
                key={candidate}
                testID={`development-preview-state-${candidate}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => selectState(page, candidate)}
                style={[styles.stateButton, { backgroundColor: selected ? colors.primary : colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.stateButtonText, { color: selected ? colors.primaryForeground : colors.foreground }]}>{STATE_LABELS[candidate] ?? candidate} · DEMO</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 19, paddingBottom: 12 },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 19, gap: 13 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 13, padding: 12 },
  bannerText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.35 },
  fixtureNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  card: { alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 19, padding: 20 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  route: { fontFamily: 'Inter_700Bold', fontSize: 24, textAlign: 'center' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  badge: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.5 },
  row: { alignSelf: 'stretch', fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 6 },
  disclaimer: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  separator: { alignSelf: 'stretch', height: StyleSheet.hairlineWidth, marginVertical: 4 },
  avatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  section: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6, marginTop: 2 },
  states: { gap: 8 },
  stateButton: { minHeight: 44, borderWidth: 1, borderRadius: 13, justifyContent: 'center', paddingHorizontal: 13 },
  stateButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
