import React from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  getMembershipDataModeConfiguration,
  loadMembershipData,
} from '@/lib/membershipDataMode';
import type { ProductionMembership } from '@/lib/productionAuthApi';

export default function MembershipMockPreviewScreen() {
  const configuration = getMembershipDataModeConfiguration();

  if (!configuration.mockPreviewAllowed) {
    return (
      <MembershipMockPreviewUnavailable
        message={configuration.error ?? 'The mock Membership preview is disabled in this build.'}
      />
    );
  }

  return <EnabledMembershipMockPreview mode={configuration.mode} />;
}

function MembershipMockPreviewUnavailable({ message }: { message: string }) {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.offWhite }]} testID="membership-mock-preview-denied">
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Preview unavailable</Text>
      <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{message}</Text>
    </View>
  );
}

function EnabledMembershipMockPreview({ mode }: { mode: 'mock' | 'production' }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const [membership, setMembership] = React.useState<ProductionMembership | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void loadMembershipData(mode, async () => {
      throw new Error('Production membership reads are disabled in the isolated preview.');
    }).then((result) => {
      if (mounted) setMembership(result as ProductionMembership);
    }).catch(() => {
      if (mounted) setFailed(true);
    });
    return () => { mounted = false; };
  }, [mode]);

  if (failed) {
    return (
      <MembershipMockPreviewUnavailable message="The local membership fixture could not be loaded." />
    );
  }
  if (!membership) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator testID="membership-mock-loading" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="membership-mock-preview">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 18, paddingBottom: bottomPad + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={[styles.eyebrow, { color: colors.mutedForegroundLight }]}>BLUEBIRD ACCOUNT</Text>
            <Text style={[styles.title, { color: colors.textOnSurface }]}>Membership</Text>
          </View>
          <View
            style={[styles.mockBadge, { backgroundColor: colors.secondary }]}
            testID="membership-mock-data-badge"
          >
            <Text style={[styles.mockBadgeText, { color: colors.primary }]}>MOCK DATA</Text>
          </View>
        </View>

        <View style={[styles.memberCard, { backgroundColor: colors.backgroundMid }]}>
          <Text style={[styles.cardEyebrow, { color: colors.mutedOnBrand }]}>CURRENT MEMBERSHIP</Text>
          <Text style={[styles.memberTier, { color: colors.textOnBrand }]}>
            {membership.tier === 'base' ? 'Base' : 'Membership'}
          </Text>
          <View style={styles.statusRow}>
            <Feather
              name={membership.isMember && membership.status === 'active' ? 'check-circle' : 'help-circle'}
              size={18}
              color={membership.isMember && membership.status === 'active' ? colors.success : colors.mutedOnBrand}
            />
            <Text
              style={[styles.memberStatus, { color: colors.textOnBrand }]}
              testID="membership-mock-status"
            >
              {membership.isMember && membership.status === 'active' ? 'Active' : 'Unavailable'}
            </Text>
          </View>
          <Text style={[styles.cardCaption, { color: colors.mutedOnBrand }]}>
            Local preview from the Production Membership response contract.
          </Text>
        </View>

        <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Membership details</Text>
          <DetailRow label="Tier" value={membership.tier === 'base' ? 'Base' : 'Unavailable'} />
          <DetailRow
            label="Membership status"
            value={membership.status === 'active' ? 'Active' : membership.status ?? 'Unavailable'}
            testID="membership-mock-detail-status"
          />
          <DetailRow
            label="Cancellation"
            value={membership.cancelAtPeriodEnd ? 'Scheduled at period end' : 'Not scheduled'}
            last
          />
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          testID="membership-mock-preview-plans"
          onPress={() => router.push('/membership/mock-preview/plans' as any)}
          style={[styles.plansButton, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.plansButtonText, { color: colors.primaryForeground }]}>Browse public plans</Text>
          <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>
        <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>
          This preview does not sign in, create a session, or load account data.
        </Text>
      </ScrollView>
    </View>
  );
}

function DetailRow({
  label,
  value,
  last = false,
  testID,
}: {
  label: string;
  value: string;
  last?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.detailRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
      ]}
    >
      <Text style={[styles.detailLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.textOnSurface }]} testID={testID}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 18, maxWidth: 680, width: '100%', alignSelf: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  titleCopy: { flex: 1, gap: 5 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 27 },
  mockBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  mockBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.7 },
  memberCard: { borderRadius: 24, padding: 22, gap: 8 },
  cardEyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.1 },
  memberTier: { fontFamily: 'Inter_700Bold', fontSize: 34 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  memberStatus: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  cardCaption: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  detailsCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 6 },
  detailRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'right' },
  plansButton: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  plansButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 14 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
