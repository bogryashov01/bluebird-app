import React from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  isMembershipDevelopmentPreviewEnabled,
  MEMBERSHIP_PREVIEW_STATES,
  parseMembershipPreviewState,
  type MembershipPreviewState,
} from '@/lib/membershipDevelopmentPreview';

const LABELS: Record<MembershipPreviewState, string> = {
  'non-member': 'Non-member',
  'active-member': 'Active member',
  unavailable: 'Membership unavailable',
  loading: 'Loading membership',
  'api-error': 'Membership API error',
};

function showPreview(state: MembershipPreviewState) {
  router.replace({ pathname: '/membership/dev-preview', params: { state } } as any);
}

export default function MembershipDevelopmentPreviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state: requestedState } = useLocalSearchParams<{ state?: string }>();
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const state = parseMembershipPreviewState(requestedState);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (!isMembershipDevelopmentPreviewEnabled(isDev)) {
    return <Redirect href="/(tabs)/membership" />;
  }

  return (
    <View testID="membership-demo-preview" style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="membership-demo-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Membership"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/membership')}
          style={[styles.backButton, { backgroundColor: colors.surface }]}
        >
          <Feather name="arrow-left" size={19} color={colors.textOnSurface} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Membership preview</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>{LABELS[state]} · DEMO</Text>
        </View>
        <TouchableOpacity
          testID="membership-demo-preview-hub"
          accessibilityRole="button"
          accessibilityLabel="Back to development preview hub"
          onPress={() => router.replace('/development-preview' as any)}
          style={[styles.backButton, { backgroundColor: colors.surface }]}
        >
          <Feather name="grid" size={17} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}>
        <View style={[styles.banner, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '44' }]}>
          <Feather name="alert-triangle" size={17} color={colors.primary} />
          <Text testID="membership-demo-label" style={[styles.bannerText, { color: colors.primary }]}>
            DEMO / DEVELOPMENT PREVIEW · NO ACCOUNT OR MEMBERSHIP CHANGED
          </Text>
        </View>
        <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {state === 'loading' ? <ActivityIndicator testID="membership-demo-loading" color={colors.primary} size="large" /> : null}
          <Text testID="membership-demo-state-title" style={[styles.stateTitle, { color: colors.textOnSurface }]}>
            {state === 'non-member' ? 'Not a member yet · DEMO'
              : state === 'active-member' ? 'Plus member · DEMO'
                : state === 'loading' ? 'Loading membership details · DEMO'
                  : state === 'api-error' ? 'Membership could not load · DEMO'
                    : 'Membership details unavailable · DEMO'}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
            {state === 'non-member'
              ? 'A confirmed non-member can browse public plans. Queue and Skip the Line Pass access require membership.'
              : state === 'active-member'
                ? 'This fixture demonstrates account-confirmed member details and benefits. It is not a real membership.'
                : state === 'loading'
                  ? 'Fixture loading state only. No request is pending.'
                  : state === 'api-error'
                    ? 'A membership API error is not proof that the account has no membership.'
                    : 'The account membership projection could not be verified.'}
          </Text>
          {state === 'active-member' ? (
            <View style={[styles.detail, { borderTopColor: colors.separator }]}>
              <Text style={[styles.detailText, { color: colors.textOnSurface }]}>Status: Active · DEMO</Text>
              <Text style={[styles.detailText, { color: colors.textOnSurface }]}>Skip the Line Pass balance: Unavailable · DEMO</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.sectionTitle, { color: colors.mutedForegroundLight }]}>Preview states</Text>
        <View style={styles.stateList}>
          {MEMBERSHIP_PREVIEW_STATES.map((previewState) => (
            <TouchableOpacity
              key={previewState}
              testID={`membership-demo-state-${previewState}`}
              accessibilityRole="button"
              onPress={() => showPreview(previewState)}
              style={[
                styles.stateButton,
                { backgroundColor: previewState === state ? colors.primary : colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.stateButtonText, {
                color: previewState === state ? colors.primaryForeground : colors.textOnSurface,
              }]}>{LABELS[previewState]} · DEMO</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 18, gap: 14 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 13, padding: 13 },
  bannerText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.4 },
  stateCard: { borderWidth: 1, borderRadius: 18, alignItems: 'center', padding: 20, gap: 12 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  detail: { alignSelf: 'stretch', borderTopWidth: 1, paddingTop: 12, gap: 8 },
  detailText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  stateList: { gap: 8 },
  stateButton: { minHeight: 46, borderWidth: 1, borderRadius: 13, justifyContent: 'center', paddingHorizontal: 14 },
  stateButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
