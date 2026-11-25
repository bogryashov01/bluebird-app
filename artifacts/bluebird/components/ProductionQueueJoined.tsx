import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import {
  canSubmitProductionQueueJoin,
  formatJoinFlightDate,
  formatJoinFlightTime,
  presentJoinedLineSkip,
  presentJoinQueueWindow,
  presentQueueCloseCountdown,
  type JoinFlightDisplay,
  type QueueJoinSuccessModel,
  type QueueSkipLineBalance,
} from '@/lib/joinFlightPresentation';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  loadDashboardSkipTheLinePasses,
  readFreshSkipTheLinePasses,
  rememberSkipTheLinePasses,
} from '@/lib/membershipDashboardRead';

export function ProductionQueueJoined({
  flight,
  success,
  onViewStatus,
}: {
  flight: JoinFlightDisplay;
  success: QueueJoinSuccessModel;
  onViewStatus: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const route = [flight.fromCity ?? flight.fromAirport, flight.toCity ?? flight.toAirport].filter(Boolean).join(' → ');
  const when = [formatJoinFlightDate(flight.departureDate), formatJoinFlightTime(flight.departureTime)].filter(Boolean).join(' · ');
  const countdown = presentQueueCloseCountdown(flight.queueClosesAt, nowMs);
  const queueWindow = presentJoinQueueWindow(flight.queueClosesAt, nowMs);
  const statusLabel = queueWindow.state === 'open' ? 'Open' : queueWindow.state === 'closed' ? 'Closed' : 'Unavailable';
  const passBalance = useJoinedPassBalance(success.lineSkipApplied);
  const lineSkip = presentJoinedLineSkip({
    userHasLineSkip: success.lineSkipApplied,
    balance: passBalance,
    mutationsEnabled: canSubmitProductionQueueJoin(),
  });

  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite, paddingTop: topPad, paddingBottom: bottomPad + 16 }]} testID="production-queue-joined">
      <View style={styles.content}>
        <View style={[styles.iconRing, { backgroundColor: colors.primary + '1F' }]}>
          <Feather name="check" size={38} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>You're in the queue</Text>
        {lineSkip.appliedMessage ? (
          <Text testID="production-queue-line-skipped" style={[styles.subtitle, { color: colors.textOnSurface }]}>
            {lineSkip.appliedMessage}
          </Text>
        ) : null}
        {!!route && <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>{route}</Text>}
        {!!when && <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>{when}</Text>}
        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: colors.surface }]}>
            <Text testID="production-queue-joined-position" style={[styles.chipValue, { color: colors.primary }]}>#{success.position}</Text>
            <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>QUEUE POSITION</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: colors.surface }]}>
            <Text testID="production-queue-joined-status" style={[styles.chipValue, { color: statusLabel === 'Open' ? colors.success : colors.textOnSurface }]}>{statusLabel}</Text>
            <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>FLIGHT STATUS</Text>
          </View>
        </View>
        {countdown && countdown !== 'closed' ? (
          <Text testID="production-queue-joined-countdown" style={[styles.countdown, { color: colors.mutedForegroundLight }]}>
            Queue closes in {countdown}
          </Text>
        ) : (
          <Text style={[styles.countdown, { color: colors.mutedForegroundLight }]}>
            {countdown === 'closed' ? 'This queue is closed.' : 'Queue closing time is not available for this flight.'}
          </Text>
        )}
        <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>A place in this queue is not a confirmed booking.</Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="View Queue Status" testID="production-queue-view-status" onPress={onViewStatus} />
        {lineSkip.offerPass ? (
          <SecondaryButton
            label="Use Skip the Line Pass Instead"
            testID="production-queue-skip-line"
            onPress={onViewStatus}
          />
        ) : null}
        {lineSkip.offerPass ? (
          <Text testID="production-queue-skip-line-note" style={[styles.note, { color: colors.mutedForegroundLight }]}>
            Use Skip the Line on Queue Status. Nothing is charged from this screen.
          </Text>
        ) : null}
        {lineSkip.noneMessage ? (
          <Text testID="production-queue-skip-none" style={[styles.note, { color: colors.mutedForegroundLight }]}>
            {lineSkip.noneMessage}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function useJoinedPassBalance(lineSkipApplied: boolean): QueueSkipLineBalance {
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const [balance, setBalance] = useState<QueueSkipLineBalance>('loading');
  useEffect(() => {
    if (lineSkipApplied) return undefined;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const signedIn = authMode === 'clerk' &&
      session?.isSignedIn === true &&
      typeof clerkUserId === 'string' &&
      clerkUserId.length > 0 &&
      session.userId === clerkUserId;
    if (!signedIn || !configuration) {
      setBalance('unavailable');
      return undefined;
    }
    const fresh = readFreshSkipTheLinePasses({
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      clerkUserId,
    });
    if (fresh) {
      setBalance({ count: fresh.count });
      return undefined;
    }
    const controller = new AbortController();
    setBalance('loading');
    void loadDashboardSkipTheLinePasses({
      signal: controller.signal,
      configuration,
      getAccessToken: async () => {
        const current = sessionRef.current;
        if (!current || current.userId !== clerkUserId || current.isSignedIn !== true) return null;
        return current.getToken();
      },
    }).then((loaded) => {
      if (controller.signal.aborted || sessionRef.current?.userId !== clerkUserId) return;
      if (loaded.kind !== 'loaded') {
        setBalance('unavailable');
        return;
      }
      rememberSkipTheLinePasses({
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        clerkUserId,
        count: loaded.count,
      });
      setBalance({ count: loaded.count });
    });
    return () => controller.abort();
  }, [authMode, clerkUserId, lineSkipApplied, session?.isSignedIn, session?.userId]);
  return lineSkipApplied ? { count: 0 } : balance;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 14 },
  iconRing: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, letterSpacing: -0.35, textAlign: 'center' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  chipRow: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: 340 },
  chip: { flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', gap: 4 },
  chipValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  chipLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6 },
  countdown: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  footer: { paddingHorizontal: 22, gap: 10 },
});
