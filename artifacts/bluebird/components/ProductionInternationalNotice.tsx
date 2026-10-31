import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import {
  canSubmitProductionQueueJoin,
  JOIN_FLIGHT_CREDIT_CONFIRM_REQUIRED,
  type JoinFlightFailure,
  type ProductionInternationalJoinStep,
  type QueueJoinConsent,
} from '@/lib/joinFlightPresentation';

export function ProductionInternationalNotice({
  step,
  submitting = false,
  failure = null,
  onJoin,
}: {
  step: Exclude<ProductionInternationalJoinStep, 'skip'>;
  submitting?: boolean;
  failure?: JoinFlightFailure | null;
  onJoin: (consent: QueueJoinConsent, creditConfirmed: boolean) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const [creditConfirmed, setCreditConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canSubmit = canSubmitProductionQueueJoin() && !submitting;
  const passValue = step === 'required'
    ? 'Choice required'
    : step === 'not-required'
      ? 'Not required'
      : 'Not confirmed';

  const join = (consent: QueueJoinConsent, confirmed: boolean) => {
    if (!canSubmit) return;
    if (consent === 'use-credit' && !confirmed) {
      setNotice(JOIN_FLIGHT_CREDIT_CONFIRM_REQUIRED);
      return;
    }
    setNotice(null);
    onJoin(consent, confirmed);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.backgroundMid }]} testID="production-international-notice">
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topPad + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.globe, { backgroundColor: colors.primary + '26' }]}>
          <Feather name="globe" size={20} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>International Flight Notice</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          This flight is international. Bluebird decides whether this account must authorize an International Pass or use an existing credit. This screen does not charge a card and does not upgrade membership.
        </Text>
        <View style={[styles.feeRow, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '18' }]}>
          <Text style={[styles.feeLabel, { color: colors.mutedOnBrand }]}>International Pass</Text>
          <Text testID="production-international-pass-state" style={[styles.feeValue, { color: colors.textOnBrand }]}>{passValue}</Text>
        </View>
        <View style={[styles.plusCard, { backgroundColor: colors.primary + '24', borderColor: colors.primary + '66' }]}>
          <View style={[styles.plusIcon, { backgroundColor: colors.primary + '35' }]}>
            <Feather name="star" size={15} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.plusTitle, { color: colors.textOnBrand }]}>Plus membership</Text>
          <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
            {step === 'not-required'
              ? 'Bluebird did not require an International Pass for this account. No waiver is applied by this screen.'
              : 'Upgrade to Plus is not available in this join flow. No upgrade is started.'}
          </Text>
        </View>
        {step === 'required' ? (
          <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
            Choose an authorization or an existing credit. Neither choice charges a card from this app.
          </Text>
        ) : (
          <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
            {step === 'unknown'
              ? 'Bluebird has not confirmed a pass requirement. Joining sends no pass flag. The server can still reject the request.'
              : 'Joining sends no International Pass flag because Bluebird did not require one.'}
          </Text>
        )}
        {step === 'required' ? (
          <TouchableOpacity
            testID="production-international-credit"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: creditConfirmed }}
            onPress={() => setCreditConfirmed((value) => !value)}
          >
            <Text style={[styles.credit, { color: colors.textOnBrand }]}>
              {creditConfirmed ? '✓ ' : '○ '}I confirm this join uses an International Pass credit. No payment is started.
            </Text>
          </TouchableOpacity>
        ) : null}
        {notice ? <Text testID="production-international-choice" style={[styles.body, { color: colors.textOnBrand }]}>{notice}</Text> : null}
        {failure ? <Text testID="production-international-error" style={[styles.body, { color: colors.textOnBrand }]}>{failure.body}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        {step === 'required' ? (
          <>
            <PrimaryButton
              label="Authorize an International Pass"
              testID="production-international-authorize"
              disabled={!canSubmit}
              loading={submitting}
              onPress={() => join('authorize-pass', false)}
            />
            <SecondaryButton
              label="Use an International Pass credit"
              testID="production-international-credit-join"
              disabled={!canSubmit}
              backgroundColor={colors.textOnBrand + '14'}
              textColor={colors.textOnBrand}
              onPress={() => join('use-credit', creditConfirmed)}
            />
          </>
        ) : (
          <PrimaryButton
            label="Join the queue"
            testID="production-international-join"
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => join('none', false)}
          />
        )}
        <Text style={[styles.hint, { color: colors.mutedOnBrand }]}>
          {canSubmitProductionQueueJoin()
            ? 'A queue request is sent only when you press a join action.'
            : 'Queue joining is not available in this build. No request is sent.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 16 },
  globe: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, letterSpacing: -0.35 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 17,
    gap: 12,
  },
  feeLabel: { fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },
  feeValue: { fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'right' },
  plusCard: { borderRadius: 17, borderWidth: 1, padding: 17, gap: 7 },
  plusIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  plusTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  credit: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 21 },
  footer: { paddingHorizontal: 22, paddingTop: 12, gap: 10 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
