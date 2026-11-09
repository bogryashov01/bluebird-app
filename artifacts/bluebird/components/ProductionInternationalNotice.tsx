import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  priceLabel = null,
  submitting = false,
  failure = null,
  onJoin,
}: {
  step: Exclude<ProductionInternationalJoinStep, 'skip'>;
  priceLabel?: string | null;
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
  const joinLock = useRef(false);
  const canSubmit = canSubmitProductionQueueJoin() && !submitting;
  useEffect(() => {
    if (!submitting) joinLock.current = false;
  }, [submitting]);
  const passValue = step === 'required'
    ? 'Choice required'
    : step === 'not-required'
      ? 'Not required'
      : 'Not confirmed';

  const join = (consent: QueueJoinConsent, confirmed: boolean) => {
    if (!canSubmit || joinLock.current) return;
    if (consent === 'use-credit' && !confirmed) {
      setNotice(JOIN_FLIGHT_CREDIT_CONFIRM_REQUIRED);
      return;
    }
    setNotice(null);
    joinLock.current = true;
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
          This flight is international. An International Pass may be required before you join. This does not charge a card.
        </Text>
        <View style={[styles.feeRow, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '18' }]}>
          <Text style={[styles.feeLabel, { color: colors.mutedOnBrand }]}>International Pass</Text>
          <Text testID="production-international-pass-state" style={[styles.feeValue, { color: colors.textOnBrand }]}>{passValue}</Text>
          {priceLabel ? (
            <Text testID="production-international-pass-price" style={[styles.feeValue, { color: colors.textOnBrand }]}>
              {priceLabel}
            </Text>
          ) : null}
        </View>
        <View style={[styles.plusCard, { backgroundColor: colors.primary + '24', borderColor: colors.primary + '66' }]}>
          <View style={[styles.plusIcon, { backgroundColor: colors.primary + '35' }]}>
            <Feather name="star" size={15} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.plusTitle, { color: colors.textOnBrand }]}>Plus membership</Text>
          <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
            {step === 'not-required'
              ? 'An International Pass is not required for this flight.'
              : 'Plus upgrades are not offered from this screen.'}
          </Text>
        </View>
        {step === 'required' ? (
          <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
            Choose an authorization or an existing credit. Neither choice charges a card from this app.
          </Text>
        ) : (
          <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
            {step === 'pending'
              ? 'Checking international access.'
              : step === 'unknown'
                ? 'Bluebird has not confirmed whether an International Pass is required.'
                : 'An International Pass is not required for this flight.'}
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
              {creditConfirmed ? '✓ ' : '○ '}Use an International Pass credit. No payment is started.
            </Text>
          </TouchableOpacity>
        ) : null}
        {notice ? <Text testID="production-international-choice" style={[styles.body, { color: colors.textOnBrand }]}>{notice}</Text> : null}
        {failure ? <Text testID="production-international-error" style={[styles.body, { color: colors.textOnBrand }]}>{failure.body}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        {step === 'pending' ? (
          <ActivityIndicator testID="production-international-entitlement" color={colors.primary} />
        ) : step === 'required' ? (
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
        {!canSubmitProductionQueueJoin() ? (
          <Text style={[styles.hint, { color: colors.mutedOnBrand }]}>
            Joining is unavailable right now.
          </Text>
        ) : null}
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
