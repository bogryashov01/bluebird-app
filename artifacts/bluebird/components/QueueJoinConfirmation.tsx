import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton } from '@/components/PrimaryButton';
import { QueueJoinSuccess } from '@/components/QueueJoinSuccess';
import {
  canSubmitProductionQueueJoin,
  formatJoinFlightDate,
  formatJoinFlightTime,
  formatQueueClosingTime,
  JOIN_FLIGHT_MEMBERSHIP_NOTE,
  JOIN_FLIGHT_CONSENT_REQUIRED,
  JOIN_FLIGHT_CREDIT_CONFIRM_REQUIRED,
  QUEUE_LEFT_CONFIRMED,
  joinFlightConfirmNote,
  joinFlightPassNote,
  presentJoinQueueWindow,
  reviewProductionQueueJoin,
  type JoinFlightDisplay,
  type JoinFlightFailure,
  type QueueJoinConsent,
  type QueueJoinSuccessModel,
} from '@/lib/joinFlightPresentation';
import { logJoinNav } from '@/lib/joinNavDiagnostics';

export function QueueJoinConfirmation({
  flight,
  success,
  demoAvailable = false,
  demoEnabled = false,
  onDemoEnabledChange,
  onDemoConfirm,
  onJoin,
  submitting = false,
  leftMessage = null,
  failure = null,
}: {
  flight: JoinFlightDisplay;
  success: QueueJoinSuccessModel | null;
  demoAvailable?: boolean;
  demoEnabled?: boolean;
  onDemoEnabledChange?: (enabled: boolean) => void;
  onDemoConfirm?: () => void;
  onJoin?: (consent: QueueJoinConsent, creditConfirmed: boolean) => void;
  submitting?: boolean;
  leftMessage?: string | null;
  failure?: JoinFlightFailure | null;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const [consent, setConsent] = useState<QueueJoinConsent>('none');
  const [creditConfirmed, setCreditConfirmed] = useState(false);
  const [consentNotice, setConsentNotice] = useState<string | null>(null);
  const joinLock = useRef(false);
  const passChoiceRequired = false;
  const queueWindow = presentJoinQueueWindow(flight.queueClosesAt, Date.now());
  const route = [flight.fromAirport, flight.toAirport].filter(Boolean).join(' → ');
  const cities = [flight.fromCity, flight.toCity].filter(Boolean).join(' → ');
  const when = [formatJoinFlightDate(flight.departureDate), formatJoinFlightTime(flight.departureTime)]
    .filter(Boolean)
    .join(' · ');
  const queueCloses = formatQueueClosingTime(flight.queueClosesAt);
  useEffect(() => {
    if (!submitting) joinLock.current = false;
  }, [submitting]);

  if (success) {
    return (
      <View style={[styles.screen, styles.successScreen, { backgroundColor: colors.offWhite, paddingBottom: bottomPad + 12 }]}>
        <QueueJoinSuccess flight={flight} success={success} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          testID="join-flight-confirmation"
          style={[styles.flightCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
        >
          <Text style={[styles.kicker, { color: colors.primary }]}>FLIGHT</Text>
          {route ? (
            <Text style={[styles.route, { color: colors.textOnSurface }]}>{route}</Text>
          ) : (
            <Text style={[styles.route, { color: colors.textOnSurface }]}>Flight details unavailable</Text>
          )}
          {!!cities && <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{cities}</Text>}
          {!!when && <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{when}</Text>}
          {!!flight.aircraft && <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{flight.aircraft}</Text>}
          <Text testID="join-flight-queue-window" style={[styles.meta, { color: colors.textOnSurface }]}>
            {queueWindow.label}
          </Text>
          <Text testID="join-flight-queue-closes" style={[styles.meta, { color: colors.mutedForegroundLight }]}>
            {queueCloses ? `Queue closes ${queueCloses}` : 'Queue closing time is not available for this flight.'}
          </Text>
        </View>

        <View
          testID="join-flight-membership"
          style={[styles.flightCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
        >
          <Text style={[styles.kicker, { color: colors.primary }]}>MEMBERSHIP</Text>
          <Text style={[styles.disclosure, { color: colors.textOnSurface }]}>{JOIN_FLIGHT_MEMBERSHIP_NOTE}</Text>
        </View>

        {passChoiceRequired ? (
          <View
            testID="join-flight-pass"
            style={[styles.flightCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
          >
            <Text style={[styles.kicker, { color: colors.primary }]}>INTERNATIONAL PASS</Text>
            <Text style={[styles.disclosure, { color: colors.textOnSurface }]}>
              This flight requires an International Pass choice before a join can be prepared. Nothing is selected until you choose.
            </Text>
            <PassChoice
              testID="join-flight-pass-authorize"
              label="Authorize an International Pass"
              selected={consent === 'authorize-pass'}
              onPress={() => {
                setCreditConfirmed(false);
                setConsent((current) => current === 'authorize-pass' ? 'none' : 'authorize-pass');
              }}
            />
            <PassChoice
              testID="join-flight-pass-credit"
              label="Use an available International Pass credit"
              selected={consent === 'use-credit'}
              onPress={() => {
                setCreditConfirmed(false);
                setConsent((current) => current === 'use-credit' ? 'none' : 'use-credit');
              }}
            />
            {consent === 'use-credit' ? (
              <PassChoice
                testID="join-flight-credit-confirm"
                label="I confirm this join uses an International Pass credit. No payment is started."
                selected={creditConfirmed}
                onPress={() => setCreditConfirmed((current) => !current)}
              />
            ) : null}
            <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{joinFlightPassNote()}</Text>
          </View>
        ) : null}

        {leftMessage === QUEUE_LEFT_CONFIRMED ? (
          <Text testID="join-flight-left" style={[styles.disclosure, { color: colors.textOnSurface }]}>
            {leftMessage}
          </Text>
        ) : null}

        {consentNotice ? (
          <Text testID="join-flight-consent-required" style={[styles.disclosure, { color: colors.textOnSurface }]}>
            {consentNotice}
          </Text>
        ) : null}
        {failure ? <JoinFailureNotice failure={failure} /> : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.separator, backgroundColor: colors.offWhite, paddingBottom: bottomPad + 12 }]}>
        {demoAvailable ? (
          <View style={styles.demoSwitch}>
            <View style={styles.demoCopy}>
              <Text style={[styles.demoTitle, { color: colors.textOnSurface }]}>Demo Join Flow</Text>
              <Text style={[styles.note, styles.demoHint, { color: colors.mutedForegroundLight }]}>
                Development only. Simulated steps stay on this device.
              </Text>
            </View>
            <Switch
              testID="demo-join-flow-switch"
              value={demoEnabled}
              onValueChange={(value) => onDemoEnabledChange?.(value)}
            />
          </View>
        ) : null}
        <PrimaryButton
          label="Join Flight"
          disabled={(!canSubmitProductionQueueJoin() && !demoEnabled) || submitting}
          loading={submitting && canSubmitProductionQueueJoin()}
          onPress={() => {
            if (submitting || joinLock.current) return;
            const decision = reviewProductionQueueJoin({
              consent,
              internationalPassRequired: passChoiceRequired,
              creditConfirmed,
            });
            logJoinNav('join-button', {
              screen: 'QueueJoinConfirmation',
              visibleLabel: 'Join Flight',
              demoEnabled: demoEnabled === true,
              routerMethod: 'none',
              targetPathname: 'none',
            });
            if (decision.status === 'consent-required') {
              setConsentNotice(consent === 'use-credit'
                ? JOIN_FLIGHT_CREDIT_CONFIRM_REQUIRED
                : JOIN_FLIGHT_CONSENT_REQUIRED);
              return;
            }
            setConsentNotice(null);
            if (decision.status === 'ready') {
              joinLock.current = true;
              onJoin?.(consent, creditConfirmed);
              return;
            }
            if (decision.status === 'disabled' && demoEnabled && !canSubmitProductionQueueJoin()) onDemoConfirm?.();
          }}
          testID="join-flight-confirm"
          accessibilityRole="button"
        />
        <Text testID="join-flight-confirm-note" style={[styles.note, { color: colors.mutedForegroundLight }]}>
          {joinFlightConfirmNote(demoEnabled)}
        </Text>
        {demoEnabled ? null : (
          <TouchableOpacity
            testID="join-flight-view-trips"
            accessibilityRole="button"
            accessibilityLabel="View My Trips"
            onPress={() => router.navigate('/(tabs)/trips')}
          >
            <Text style={[styles.tripsLink, { color: colors.primary }]}>View My Trips</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function PassChoice({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.passChoice, { borderColor: selected ? colors.primary : colors.separator }]}
    >
      <View style={[styles.passMark, { borderColor: colors.primary, backgroundColor: selected ? colors.primary : 'transparent' }]} />
      <Text style={[styles.disclosure, { color: colors.textOnSurface }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function JoinFailureNotice({ failure }: { failure: JoinFlightFailure }) {
  const colors = useColors();
  const route = [failure.conflict?.originAirport, failure.conflict?.destinationAirport].filter(Boolean).join(' → ');
  return (
    <View
      testID="join-flight-error"
      style={[styles.flightCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
    >
      <Text style={[styles.kicker, { color: colors.primary }]}>{failure.title}</Text>
      <Text style={[styles.disclosure, { color: colors.textOnSurface }]}>{failure.body}</Text>
      {failure.conflict ? (
        <Text testID="join-flight-conflict" style={[styles.meta, { color: colors.textOnSurface }]}>
          {[route, failure.conflict.departureTime].filter(Boolean).join(' · ') || 'The conflicting flight did not include route details.'}
        </Text>
      ) : null}
      {failure.keepsExistingQueue ? (
        <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>The existing queue stays in place.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  successScreen: { justifyContent: 'center' },
  content: { padding: 16, gap: 16, paddingBottom: 24 },
  flightCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.7 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.3 },
  queueCount: { fontSize: 18 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  disclosure: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  demoSwitch: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  demoCopy: { flex: 1, gap: 2 },
  demoTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  demoHint: { textAlign: 'left' },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  tripsLink: { fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center', paddingVertical: 4 },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  rosterPosition: { fontFamily: 'Inter_700Bold', fontSize: 15, width: 36 },
  rosterInitials: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rosterTier: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  rosterSkip: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  rosterYou: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  passChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 8,
    minHeight: 44,
  },
  passMark: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
});
