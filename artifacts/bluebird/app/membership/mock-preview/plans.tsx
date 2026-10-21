import React from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useProductionMembershipPlans } from '@/hooks/useProductionMembershipPlans';
import { formatProductionPlanPrice } from '@/lib/productionMembershipPlans';
import { getMembershipDataModeConfiguration } from '@/lib/membershipDataMode';

export default function MembershipMockPreviewPlansScreen() {
  const configuration = getMembershipDataModeConfiguration();
  if (!configuration.mockPreviewAllowed) {
    return <UnavailablePlans message={configuration.error ?? 'Public plans are unavailable in this build.'} />;
  }
  return <PublicPlans />;
}

function UnavailablePlans({ message }: { message: string }) {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.offWhite }]} testID="membership-mock-plans-denied">
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Preview unavailable</Text>
      <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{message}</Text>
    </View>
  );
}

function PublicPlans() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const plansQuery = useProductionMembershipPlans();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="membership-mock-public-plans">
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topPad + 18, paddingBottom: bottomPad + 24 }]}>
        <Text style={[styles.eyebrow, { color: colors.mutedForegroundLight }]}>PUBLIC CATALOG</Text>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Membership plans</Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          Public plan details are separate from your local membership fixture.
        </Text>

        {plansQuery.isLoading ? (
          <View style={styles.centered} testID="membership-mock-plans-loading">
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Loading public plans…</Text>
          </View>
        ) : plansQuery.isError || !plansQuery.data ? (
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]} testID="membership-mock-plans-error">
            Public plan information is unavailable.
          </Text>
        ) : plansQuery.data.plans.length === 0 ? (
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]} testID="membership-mock-plans-empty">
            No public plans are currently listed.
          </Text>
        ) : (
          plansQuery.data.plans.map((plan) => (
            <View
              key={plan.tier}
              style={[styles.planCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              testID={`membership-mock-plan-${plan.tier}`}
            >
              <Text style={[styles.planName, { color: colors.textOnSurface }]}>{plan.name}</Text>
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
                {formatProductionPlanPrice(plan)}
              </Text>
            </View>
          ))
        )}

        <TouchableOpacity
          accessibilityRole="button"
          testID="membership-mock-preview-back"
          onPress={() => router.replace('/membership/mock-preview' as any)}
          style={[styles.backButton, { borderColor: colors.border }]}
        >
          <Feather name="arrow-left" size={17} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>Back to Membership preview</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 14, maxWidth: 680, width: '100%', alignSelf: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  planCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16, gap: 6 },
  planName: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  backButton: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
