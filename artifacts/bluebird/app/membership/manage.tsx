import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Modal,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMembership, useChangeMembership } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

const TIER_META: Record<string, { label: string; price: string; color: string }> = {
  base:      { label: 'Base',      price: '$99 / mo',  color: '#8896B3' },
  plus:      { label: 'Plus',      price: '$995 / mo', color: '#1259F2' },
  concierge: { label: 'Concierge', price: '$799 / mo', color: '#F59E0B' },
};
const TIER_IDX: Record<string, number> = { base: 0, plus: 1, concierge: 2 };

type PendingAction =
  | { action: 'downgrade'; tier: 'base' | 'plus' }
  | { action: 'cancel' }
  | { action: 'revert' };

export default function ManagePlanScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const queryClient = useQueryClient();
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership, isLoading } = useGetMembership({});
  const mem = membership as any;

  const [confirming, setConfirming] = React.useState<PendingAction | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const changeMutation = useChangeMembership({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['getMembership'] });
        queryClient.invalidateQueries();
        setConfirming(null);
      },
      onError: (err: any) => {
        setConfirming(null);
        setErrorMsg(err?.response?.data?.error ?? 'Could not update your plan. Please try again.');
      },
    },
  });

  if (isLoading || !mem) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const currentTier: string = mem.tier ?? 'base';
  const currentIdx = TIER_IDX[currentTier] ?? 0;
  const meta = TIER_META[currentTier] ?? TIER_META.base;
  const renewal: string = mem.renewalDate ?? '';
  const pendingTier: string | undefined = mem.pendingTier;
  const lowerTiers = Object.keys(TIER_IDX).filter((t) => TIER_IDX[t] < currentIdx);

  const confirmCopy = (a: PendingAction) => {
    if (a.action === 'downgrade') {
      const t = TIER_META[a.tier];
      return {
        title: `Downgrade to ${t.label}?`,
        body: `You'll keep your ${meta.label} benefits until ${renewal}. On that date your plan changes to ${t.label} (${t.price}).`,
        cta: `Confirm downgrade`,
        destructive: false,
      };
    }
    if (a.action === 'cancel') {
      return {
        title: 'Cancel membership?',
        body: `Your membership stays active until ${renewal}. After that you'll lose access to member benefits. You can rejoin anytime.`,
        cta: 'Confirm cancellation',
        destructive: true,
      };
    }
    return {
      title: 'Keep your current plan?',
      body: `Your scheduled plan change will be removed and your ${meta.label} membership will continue as usual.`,
      cta: 'Keep my plan',
      destructive: false,
    };
  };

  const submit = (a: PendingAction) => {
    setErrorMsg(null);
    changeMutation.mutate({
      data: a.action === 'downgrade'
        ? { action: 'downgrade', tier: a.tier }
        : { action: a.action },
    } as any);
  };

  const pendingLabel = pendingTier === 'cancelled'
    ? `Your membership is set to cancel on ${renewal}.`
    : pendingTier
      ? `Your plan changes to ${TIER_META[pendingTier]?.label ?? pendingTier} on ${renewal}.`
      : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Current plan */}
        <View style={[styles.planCard, { backgroundColor: meta.color }]}>
          <Text style={[styles.planLabel, { color: colors.primaryForeground }]}>Bluebird {meta.label}</Text>
          <Text style={[styles.planPrice, { color: colors.primaryForeground + 'E6' }]}>{meta.price}</Text>
          <Text style={[styles.planSub, { color: colors.primaryForeground + 'BF' }]}>Renews {renewal} · Month-to-month, cancel anytime</Text>
        </View>

        {/* Pending change banner */}
        {pendingLabel && (
          <View style={[styles.pendingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.pendingTitle, { color: colors.textOnSurface }]}>Scheduled change</Text>
            <Text style={[styles.pendingBody, { color: colors.mutedForegroundLight }]}>{pendingLabel} You keep your current benefits until then.</Text>
            <TouchableOpacity
              style={[styles.keepBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.85}
              onPress={() => setConfirming({ action: 'revert' })}
            >
              <Text style={[styles.keepBtnText, { color: colors.primaryForeground }]}>Keep my current plan</Text>
            </TouchableOpacity>
          </View>
        )}

        {errorMsg && <Text style={[styles.errorText, { color: colors.destructive }]}>{errorMsg}</Text>}

        {/* Downgrade options */}
        {!pendingTier && lowerTiers.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Move to a lower plan</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {lowerTiers.map((t, i) => {
                const tm = TIER_META[t];
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.optionRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}
                    activeOpacity={0.7}
                    onPress={() => setConfirming({ action: 'downgrade', tier: t as 'base' | 'plus' })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionTitle, { color: colors.textOnSurface }]}>Downgrade to {tm.label}</Text>
                      <Text style={[styles.optionSub, { color: colors.mutedForegroundLight }]}>{tm.price} · effective {renewal}</Text>
                    </View>
                    <Text style={[styles.chevron, { color: colors.mutedForegroundLight }]}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Cancel */}
        {!pendingTier && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Cancel</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <TouchableOpacity
                style={styles.optionRow}
                activeOpacity={0.7}
                onPress={() => setConfirming({ action: 'cancel' })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionTitle, { color: colors.destructive }]}>Cancel membership</Text>
                  <Text style={[styles.optionSub, { color: colors.mutedForegroundLight }]}>Benefits continue until {renewal}</Text>
                </View>
                <Text style={[styles.chevron, { color: colors.mutedForegroundLight }]}>›</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>
              Memberships are month-to-month. Changes take effect at your next renewal — no partial-month charges.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Confirmation modal */}
      <Modal visible={!!confirming} transparent animationType="fade" onRequestClose={() => setConfirming(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            {confirming && (() => {
              const c = confirmCopy(confirming);
              return (
                <>
                  <Text style={[styles.modalTitle, { color: colors.textOnSurface }]}>{c.title}</Text>
                  <Text style={[styles.modalBody, { color: colors.mutedForegroundLight }]}>{c.body}</Text>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: c.destructive ? colors.destructive : colors.primary, opacity: changeMutation.isPending ? 0.7 : 1 }]}
                    activeOpacity={0.85}
                    disabled={changeMutation.isPending}
                    onPress={() => submit(confirming)}
                  >
                    {changeMutation.isPending
                      ? <ActivityIndicator color={c.destructive ? colors.destructiveForeground : colors.primaryForeground} />
                      : <Text style={[styles.modalBtnText, { color: c.destructive ? colors.destructiveForeground : colors.primaryForeground }]}>{c.cta}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    activeOpacity={0.7}
                    disabled={changeMutation.isPending}
                    onPress={() => setConfirming(null)}
                  >
                    <Text style={[styles.modalCancelText, { color: colors.mutedForegroundLight }]}>Never mind</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  planCard: { borderRadius: 24, padding: 22, marginBottom: 22 },
  planLabel: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  planPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 4 },
  planSub: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 8 },

  pendingCard: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 22 },
  pendingTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginBottom: 6 },
  pendingBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20, marginBottom: 14 },
  keepBtn: { borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  keepBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
  },
  card: {
    borderRadius: 18, overflow: 'hidden', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  optionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  optionSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, marginTop: 2 },
  chevron: { fontSize: 22, fontFamily: 'Inter_400Regular' },

  note: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: -6 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', marginBottom: 14 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(10,17,40,0.55)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24,
  },
  modalCard: { borderRadius: 22, padding: 22, width: '100%', maxWidth: 400 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 8 },
  modalBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20, marginBottom: 20 },
  modalBtn: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  modalBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  modalCancelBtn: { paddingVertical: 14, alignItems: 'center' },
  modalCancelText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
