import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

function paramValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] ?? null : null;
}

export default function SkipLinePassDetailsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { flightId: rawFlightId, route: rawRoute, flightAvailable: rawAvailable } =
    useLocalSearchParams<{ flightId?: string; route?: string; flightAvailable?: string }>();
  const flightId = paramValue(rawFlightId);
  const flightRoute = paramValue(rawRoute);
  const flightAvailable = paramValue(rawAvailable) === 'true';
  const topPad = Platform.OS === 'web' ? 54 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 28 : insets.bottom;

  if (!flightId) {
    return <Redirect href="/(tabs)/discover" />;
  }

  return (
    <View testID="skip-line-pass-page" style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity
          testID="skip-line-pass-back"
          accessibilityRole="button"
          accessibilityLabel="Back to flight details"
          onPress={() => router.canGoBack() ? router.back() : router.replace(`/flight/${flightId}` as any)}
          style={[styles.backButton, { backgroundColor: colors.surface }]}
        >
          <Feather name="arrow-left" size={19} color={colors.textOnSurface} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: colors.textOnSurface }]}>Skip the Line Pass</Text>
          {!!flightRoute && (
            <Text style={[styles.headerSubtitle, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
              {flightRoute}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroIcon, { backgroundColor: colors.primary + '18' }]}>
          <Feather name="fast-forward" size={27} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Skip the Line</Text>
        <Text style={[styles.intro, { color: colors.mutedForegroundLight }]}>
          A Skip the Line Pass may be used to request an instant booking on a qualifying flight.
        </Text>

        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <View style={styles.infoRow}>
            <Feather name="check-circle" size={18} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.textOnSurface }]}>
              Pass ownership and flight eligibility must be verified before a booking can be confirmed.
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Feather name="users" size={18} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.textOnSurface }]}>
              A seat must still be available. Opening flight details does not reserve a seat.
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Feather name="shield" size={18} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.textOnSurface }]}>
              Pass ownership cannot be verified on this screen.
            </Text>
          </View>
        </View>

        {!flightAvailable && (
          <View style={[styles.unavailableNote, { backgroundColor: colors.muted }]}>
            <Text style={[styles.unavailableText, { color: colors.mutedForegroundLight }]}>
              This flight is not currently accepting requests.
            </Text>
          </View>
        )}

        <View style={[styles.noticeCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
          <Text testID="skip-line-instant-booking-notice" style={[styles.noticeTitle, { color: colors.primary }]}>
            Instant booking is coming soon.
          </Text>
          <Text style={[styles.noticeBody, { color: colors.mutedForegroundLight }]}>
            This flight cannot be booked with a pass from here yet. No pass or seat has been used or reserved.
          </Text>
        </View>

        <Text testID="skip-line-purchase-notice" style={[styles.purchaseNotice, { color: colors.mutedForegroundLight }]}>
          Purchasing will be available soon.
        </Text>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 12 },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  headerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 20, paddingTop: 12, alignItems: 'stretch' },
  heroIcon: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, textAlign: 'center' },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  infoCard: { borderWidth: 1, borderRadius: 17, padding: 16, gap: 16 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  infoText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  unavailableNote: { borderRadius: 13, padding: 13, marginTop: 14 },
  unavailableText: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  noticeCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 18 },
  noticeTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'center' },
  noticeBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  purchaseNotice: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center', marginTop: 18 },
});
