import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { SettingsGroup } from '@/components/SettingsGroup';
import { getFullAppDemoMembership, getFullAppDemoProfile } from '@/lib/fullAppDemo';
import { useFullAppDemoQueue } from '@/lib/fullAppDemoQueue';

export function FullAppDemoMembershipView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const membership = getFullAppDemoMembership();
  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.offWhite }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Platform.OS === 'web' ? 67 : insets.top + 16 },
      ]}
      testID="full-app-demo-membership"
    >
      <Text style={[styles.eyebrow, { color: colors.mutedForegroundLight }]}>BLUEBIRD ACCOUNT</Text>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Membership</Text>
      <View style={[styles.memberCard, { backgroundColor: colors.backgroundMid }]}>
        <Text style={[styles.cardEyebrow, { color: colors.mutedOnBrand }]}>CURRENT MEMBERSHIP</Text>
        <Text style={[styles.memberTier, { color: colors.textOnBrand }]}>
          {membership.tier === 'base' ? 'Base' : 'Membership'}
        </Text>
        <Text style={[styles.memberStatus, { color: colors.textOnBrand }]}>
          {membership.isMember && membership.status === 'active' ? 'Active' : 'Unavailable'}
        </Text>
        <Text style={[styles.cardCaption, { color: colors.mutedOnBrand }]}>
          Local demo data only. No membership account or live services are connected.
        </Text>
      </View>
      <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Membership details</Text>
        <DemoDetail label="Tier" value="Base" />
        <DemoDetail label="Membership status" value="Active" />
        <DemoDetail label="Cancellation" value="Not scheduled" last />
      </View>
      <TouchableOpacity
        testID="full-app-demo-browse-plans"
        accessibilityRole="button"
        onPress={() => router.push('/membership/plans' as any)}
        style={[styles.plansButton, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.plansButtonText, { color: colors.primaryForeground }]}>Browse plans</Text>
      </TouchableOpacity>
      <Text style={[styles.notice, { color: colors.mutedForegroundLight }]}>
        Plans and account actions are unavailable in this local demo.
      </Text>
    </ScrollView>
  );
}

export function FullAppDemoPlansView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.offWhite }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 }]}
      testID="full-app-demo-plans"
    >
      <Text style={[styles.eyebrow, { color: colors.mutedForegroundLight }]}>LOCAL DEMO</Text>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Membership plans</Text>
      <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Plan catalog unavailable</Text>
        <Text style={[styles.notice, { color: colors.mutedForegroundLight }]}>
          This demo does not request public plan data. Pricing, benefits, and purchase actions are not available.
        </Text>
      </View>
    </ScrollView>
  );
}

export function FullAppDemoProfileView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const profile = getFullAppDemoProfile();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.offWhite }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 },
      ]}
      testID="full-app-demo-profile"
    >
      <Text style={[styles.eyebrow, { color: colors.mutedForegroundLight }]}>LOCAL DEMO PROFILE</Text>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Profile</Text>
      <View style={[styles.profileCard, { backgroundColor: colors.surface }]}>
        <View style={[styles.avatar, { backgroundColor: colors.backgroundMid }]}>
          <Text style={[styles.avatarText, { color: colors.textOnBrand }]}>PM</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={[styles.profileName, { color: colors.textOnSurface }]}>{name}</Text>
          <Text style={[styles.notice, { color: colors.mutedForegroundLight }]}>Base Member</Text>
        </View>
      </View>
      <SettingsGroup
        title="Sample API flags · informational only"
        rows={[
          { testID: 'full-app-demo-admin-flag', label: 'Admin flag', hint: String(profile.isAdmin), disabled: true },
          { testID: 'full-app-demo-concierge-flag', label: 'Concierge flag', hint: String(profile.isConcierge), disabled: true },
        ]}
      />
      <SettingsGroup
        title="Account"
        rows={[
          { label: 'Personal Information', hint: 'Unavailable in local demo', disabled: true },
          { label: 'Payment Methods', hint: 'Unavailable in local demo', disabled: true },
          { label: 'Notifications', hint: 'Unavailable in local demo', disabled: true },
        ]}
      />
      <Text style={[styles.notice, { color: colors.mutedForegroundLight }]}>
        This sample is display data only. It is not a signed-in account and grants no access.
      </Text>
    </ScrollView>
  );
}

export function FullAppDemoMyQueueView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { entries, hydrated, storageError } = useFullAppDemoQueue();
  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Platform.OS === 'web' ? 67 : insets.top + 16, paddingBottom: insets.bottom + 100 },
      ]}
      testID="full-app-demo-trips"
    >
      <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>DEMO MODE · LOCAL ONLY</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>My Queue</Text>
      <Text style={[styles.notice, { color: colors.mutedForeground }]}>
        These simulated entries use live Production flight details. They are not bookings and do not change a real queue.
      </Text>
      {storageError && (
        <Text testID="full-app-demo-queue-storage-error" style={[styles.notice, { color: colors.mutedForeground }]}>
          {storageError}
        </Text>
      )}
      {!hydrated ? (
        <View testID="full-app-demo-my-queue-loading" style={[styles.queueState, { backgroundColor: colors.card }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.notice, { color: colors.mutedForeground }]}>Loading local demo queue…</Text>
        </View>
      ) : entries.length ? (
        <View style={styles.queueList}>
          {entries.map(({ flightId, flight }) => {
            const route = `${flight.fromAirport || flight.fromCity || '—'} → ${flight.toAirport || flight.toCity || '—'}`;
            const detail = [
              flight.aircraftTypeName || flight.aircraftType || flight.aircraftTypeCode,
              formatDemoFlightDate(flight.departureDate, flight.departureTime, flight.departureTimeZone),
            ].filter(Boolean).join(' · ');
            return (
              <TouchableOpacity
                key={flightId}
                testID={`full-app-demo-queue-flight-${flightId}`}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/demo/flight/[id]' as any, params: { id: flightId } })}
                style={[styles.queueFlightCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.simulatedBadge, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.simulatedBadgeText, { color: colors.secondaryForeground }]}>SIMULATED QUEUE</Text>
                </View>
                <Text style={[styles.queueFlightRoute, { color: colors.foreground }]}>{route}</Text>
                <Text style={[styles.queueFlightMeta, { color: colors.mutedForeground }]}>{detail || 'Flight details unavailable'}</Text>
                <Text style={[styles.queueFlightMeta, { color: colors.mutedForeground }]}>Live flight #{flightId} · Local demo only</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View testID="full-app-demo-my-queue-empty" style={[styles.queueState, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>No simulated flights yet</Text>
          <Text style={[styles.notice, { color: colors.mutedForeground }]}>
            Open a live flight in Discover and join its simulated queue to see it here.
          </Text>
          <TouchableOpacity
            testID="full-app-demo-my-queue-discover"
            accessibilityRole="button"
            onPress={() => router.replace('/(tabs)/discover')}
            style={[styles.plansButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.plansButtonText, { color: colors.primaryForeground }]}>Browse live flights</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function formatDemoFlightDate(date: string | null, time: string | null, timeZone: string | null): string {
  const dateLabel = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : '';
  return [dateLabel, time, timeZone].filter(Boolean).join(' · ');
}

function DemoDetail({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.detailRow, !last && { borderBottomColor: colors.separator }]}>
      <Text style={[styles.detailLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.textOnSurface }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 27 },
  memberCard: { borderRadius: 24, padding: 22, gap: 8 },
  cardEyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.1 },
  memberTier: { fontFamily: 'Inter_700Bold', fontSize: 34 },
  memberStatus: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  plansButton: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  plansButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardCaption: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  detailsCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 6 },
  detailRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'right' },
  notice: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, padding: 16 },
  avatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  profileCopy: { flex: 1, gap: 3 },
  profileName: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  queueState: { borderRadius: 18, padding: 20, gap: 10, alignItems: 'flex-start' },
  queueList: { gap: 12 },
  queueFlightCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  simulatedBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  simulatedBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  queueFlightRoute: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  queueFlightMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
