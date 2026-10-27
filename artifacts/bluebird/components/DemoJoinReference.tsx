import React, { useEffect, useState } from 'react';
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { QueueJoinSuccess } from '@/components/QueueJoinSuccess';
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import {
  DEMO_POLICY_ACKNOWLEDGEMENTS,
  canContinueDemoPolicy,
  shouldShowDemoInternationalNotice,
  simulatedInternationalFeeLabel,
  simulatedQueueMovement,
  type DemoJoinEntry,
} from '@/lib/demoJoinFlow';
import {
  joinFlightRouteParams,
  parseJoinFlightDisplay,
  type JoinFlightDisplay,
} from '@/lib/joinFlightPresentation';
import { logJoinNav, useJoinNavMount } from '@/lib/joinNavDiagnostics';

function useSimulatedClose(joinedAt: string | null): string {
  const [label, setLabel] = useState('Simulated');
  useEffect(() => {
    if (!joinedAt) return undefined;
    const target = Date.parse(joinedAt) + 2 * 60 * 60 * 1000;
    const tick = () => {
      const diff = target - Date.now();
      if (!Number.isFinite(diff) || diff <= 0) {
        setLabel('Simulated close');
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setLabel(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [joinedAt]);
  return label;
}

function OffState() {
  const colors = useColors();
  return (
    <View style={[styles.screen, styles.centered, { backgroundColor: colors.offWhite }]}>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Demo Join Flow is off</Text>
      <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
        Turn it on from Flight Details. No production request was sent.
      </Text>
    </View>
  );
}

export function DemoPolicyScreen({ params }: { params: Record<string, string | string[] | undefined> }) {
  useJoinNavMount('component/DemoPolicyScreen');
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemoJoinFlow();
  const flight = parseJoinFlightDisplay(params);
  const [checked, setChecked] = useState([false, false, false]);
  const ready = canContinueDemoPolicy(checked);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  if (!demo.available || !demo.enabled || !flight) return <OffState />;
  const route = [flight.fromCity ?? flight.fromAirport, flight.toCity ?? flight.toAirport].filter(Boolean).join(' → ');

  const continuePolicy = () => {
    if (!ready) return;
    if (shouldShowDemoInternationalNotice(flight.international)) {
      logJoinNav('demo-policy-continue', {
        currentPathname: '/flight/join',
        targetPathname: '/flight/demo-intl',
        flightId: flight.flightId,
        demoEnabled: demo.enabled,
        routerMethod: 'push',
      });
      router.push({
        pathname: '/flight/demo-intl',
        params: {
          flightId: String(flight.flightId),
          from: flight.fromAirport ?? '',
          to: flight.toAirport ?? '',
          fromCity: flight.fromCity ?? '',
          toCity: flight.toCity ?? '',
          departureDate: flight.departureDate ?? '',
          departureTime: flight.departureTime ?? '',
          aircraft: flight.aircraft ?? '',
          international: '1',
          flightStatus: flight.flightStatus === 'published' ? 'published' : '',
        },
      });
      return;
    }
    const created = demo.join(flight);
    if (created) {
      logJoinNav('demo-policy-continue', {
        currentPathname: '/flight/join',
        targetPathname: '/flight/demo-joined',
        flightId: flight.flightId,
        demoEnabled: demo.enabled,
        routerMethod: 'replace',
      });
      router.replace('/flight/demo-joined');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite }]} testID="demo-policy-screen">
      <FloatingBackButton />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topPad + 72 }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.demoMark, { color: colors.primary }]}>DEMO</Text>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Before you join{'\n'}the queue</Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          Please review and confirm the following{route ? ` for ${route}` : ''}.
        </Text>
        {DEMO_POLICY_ACKNOWLEDGEMENTS.map((label, index) => (
          <TouchableOpacity
            key={label}
            testID={`demo-policy-ack-${index}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checked[index] }}
            style={[styles.checkRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}
            onPress={() => setChecked((current) => current.map((item, itemIndex) => itemIndex === index ? !item : item))}
          >
            <View style={[styles.checkbox, { borderColor: checked[index] ? colors.primary : colors.border, backgroundColor: checked[index] ? colors.primary : 'transparent' }]}>
              {checked[index] ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
            </View>
            <Text style={[styles.checkText, { color: colors.textOnSurface }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        {!ready ? <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>Check all items above to continue</Text> : null}
        <PrimaryButton
          label="I Acknowledge — Continue"
          testID="demo-policy-continue"
          disabled={!ready}
          onPress={continuePolicy}
        />
      </View>
    </View>
  );
}

export function DemoInternationalScreen({ params }: { params: Record<string, string | string[] | undefined> }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemoJoinFlow();
  const flight = parseJoinFlightDisplay(params);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  if (!demo.available || !demo.enabled || !flight) return <OffState />;
  if (!shouldShowDemoInternationalNotice(flight.international)) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.backgroundMid }]} testID="demo-intl-skipped">
        <Text style={[styles.title, { color: colors.textOnBrand }]}>Domestic demo flight</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          The international notice is shown only for an international demo flight.
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.screen, { backgroundColor: colors.backgroundMid }]} testID="demo-intl-screen">
      <FloatingBackButton variant="brand" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topPad + 76 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.globe, { backgroundColor: colors.primary + '26' }]}>
          <Feather name="globe" size={20} color={colors.primary} />
        </View>
        <Text style={[styles.demoMark, { color: colors.primary }]}>DEMO</Text>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>International Flight Notice</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          This simulated notice is only for an international demo flight. No fee is charged and no membership is changed.
        </Text>
        <View style={[styles.feeRow, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '18' }]}>
          <Text style={[styles.feeLabel, { color: colors.mutedOnBrand }]}>Simulated international fee</Text>
          <Text testID="demo-intl-fee" style={[styles.feeValue, { color: colors.textOnBrand }]}>{simulatedInternationalFeeLabel()}</Text>
        </View>
        <View style={[styles.plusCard, { backgroundColor: colors.primary + '24', borderColor: colors.primary + '66' }]}>
          <Text style={[styles.plusTitle, { color: colors.textOnBrand }]}>Plus Membership benefit</Text>
          <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
            Simulated Plus benefit. Upgrading is unavailable in this demo and does not start a purchase.
          </Text>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <PrimaryButton label="Upgrade to Plus" disabled onPress={() => undefined} testID="demo-intl-upgrade" />
        <SecondaryButton
          label="Continue with Base"
          testID="demo-intl-continue"
          backgroundColor={colors.textOnBrand + '14'}
          textColor={colors.textOnBrand}
          onPress={() => {
            const created = demo.join(flight);
            if (created) router.replace('/flight/demo-joined');
          }}
        />
        <Text style={[styles.hint, { color: colors.mutedOnBrand }]}>Simulated — no payment or credit reservation.</Text>
      </View>
    </View>
  );
}

export function DemoQueueJoinedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemoJoinFlow();
  const entry = demo.enabled ? demo.entry : null;
  const countdown = useSimulatedClose(entry?.joinedAt ?? null);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  if (!entry) return <OffState />;
  const flight = toDisplay(entry);
  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite, paddingTop: topPad, paddingBottom: bottomPad + 16 }]} testID="demo-joined-screen">
      <View style={styles.joinedBody}>
        <QueueJoinSuccess
          flight={flight}
          success={{ flightId: entry.flightId, position: entry.position, participantCount: entry.participantCount }}
          flightStatusLabel="Open"
          demoNotice="DEMO — No real queue entry created. Position is simulated."
        />
        <Text testID="demo-queue-countdown" style={[styles.countdown, { color: colors.mutedForegroundLight }]}>
          Queue closes in {countdown}
        </Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="View Queue Status" testID="demo-join-view-status" onPress={() => router.push('/flight/demo-status')} />
        <SecondaryButton label="Use Skip the Line Pass Instead" testID="demo-join-skip-line" onPress={() => router.push('/flight/demo-pass')} />
      </View>
    </View>
  );
}

export function DemoQueueStatusScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemoJoinFlow();
  const entry = demo.enabled ? demo.entry : null;
  const countdown = useSimulatedClose(entry?.joinedAt ?? null);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  if (!entry) return <OffState />;
  const route = [entry.fromAirport, entry.toAirport].filter(Boolean).join(' → ') || 'Simulated flight';
  const movement = simulatedQueueMovement(entry);
  const progress = entry.participantCount > 1 ? (entry.participantCount - entry.position) / (entry.participantCount - 1) : 1;
  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite }]} testID="demo-status-screen">
      <FloatingBackButton />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topPad + 72, paddingBottom: bottomPad + 150, alignItems: 'center' }]}>
        <Text style={[styles.demoMark, { color: colors.primary }]}>DEMO</Text>
        <Text style={[styles.route, { color: colors.textOnSurface }]}>{route}</Text>
        <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>Simulated position. Not a production queue position.</Text>
        <View style={styles.ringWrap}>
          <Svg width={150} height={150} viewBox="0 0 90 90">
            <Circle cx="45" cy="45" r="40" fill="none" stroke={colors.separator} strokeWidth="8" />
            <Circle cx="45" cy="45" r="40" fill="none" stroke={colors.primary} strokeWidth="8" strokeLinecap="round" strokeDasharray={251} strokeDashoffset={251 * (1 - progress)} transform="rotate(-90, 45, 45)" />
          </Svg>
          <View style={styles.ringLabel}>
            <Text style={[styles.ringValue, { color: colors.textOnSurface }]}>
              {entry.position}<Text style={[styles.ringTotal, { color: colors.mutedForegroundLight }]}>/{entry.participantCount}</Text>
            </Text>
            <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>POSITION</Text>
          </View>
        </View>
        <Text style={[styles.countdown, { color: colors.primary }]}>Simulated close in {countdown}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>Queue movement</Text>
          {movement.map((row) => (
            <View key={row.text} style={styles.logRow}>
              <Text style={[styles.checkText, { color: colors.mutedForegroundLight }]}>{row.text}</Text>
              <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>{row.time}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.logRow}>
            <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>Flight Status</Text>
            <Text style={[styles.checkText, { color: colors.success }]}>Open · simulated</Text>
          </View>
        </View>
        <View style={[styles.notice, { backgroundColor: colors.primary + '14' }]}>
          <Text style={[styles.checkText, { color: colors.textOnSurface }]}>
            Flights may be modified or cancelled due to operational requirements. This notice is part of the demo.
          </Text>
        </View>
      </ScrollView>
      <View style={[styles.footer, styles.statusFooter, { backgroundColor: colors.offWhite, paddingBottom: bottomPad + 12 }]}>
        <PrimaryButton label="Use Skip the Line Pass" testID="demo-status-skip-line" onPress={() => router.push('/flight/demo-pass')} />
        <SecondaryButton label="Ask AI Concierge" testID="demo-status-concierge" onPress={() => router.push({
          pathname: '/concierge',
          params: joinFlightRouteParams(entry.flightId, {
            fromAirport: entry.fromAirport,
            toAirport: entry.toAirport,
            fromCity: entry.fromCity,
            toCity: entry.toCity,
            departureDate: entry.departureDate,
            departureTime: entry.departureTime,
            aircraftType: entry.aircraft,
            aircraftTypeName: entry.aircraft,
            international: entry.international,
            status: entry.flightStatus,
          }),
        })} />
      </View>
    </View>
  );
}

export function DemoSkipLineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemoJoinFlow();
  const entry = demo.enabled ? demo.entry : null;
  const [result, setResult] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  if (!entry) return <OffState />;
  const route = [entry.fromAirport, entry.toAirport].filter(Boolean).join(' → ');
  const confirm = () => {
    const next = demo.useSimulatedPass();
    setSheetOpen(false);
    setResult(next
      ? 'Simulated pass use only. This does not confirm a production seat or close the real queue.'
      : 'No simulated pass was used.');
  };
  return (
    <View style={[styles.screen, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]} testID="demo-pass-screen">
      <FloatingBackButton variant="brand" />
      <View style={[styles.content, { paddingTop: 76 }]}>
        <Text style={[styles.demoMark, { color: colors.primary }]}>DEMO</Text>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>Skip the Line Pass</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          The reference design describes an immediate win. This demo only changes local state. It does not call Skip the Line and does not use a real credit.
        </Text>
        <View style={[styles.feeRow, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '14' }]}>
          <View>
            <Text style={[styles.feeLabel, { color: colors.mutedOnBrand }]}>SIMULATED PASS BALANCE</Text>
            <Text testID="demo-pass-balance" style={[styles.feeValue, { color: colors.textOnBrand }]}>{demo.passBalance} pass{demo.passBalance === 1 ? '' : 'es'}</Text>
          </View>
          <TouchableOpacity testID="demo-pass-buy-more" style={[styles.buyMore, { backgroundColor: colors.primary + '33' }]} onPress={() => router.push('/flight/demo-purchase')}>
            <Text style={[styles.buyMoreText, { color: colors.primaryForeground }]}>Buy More</Text>
          </TouchableOpacity>
        </View>
        {!!result && <Text testID="demo-pass-result" style={[styles.body, { color: colors.textOnBrand }]}>{result}</Text>}
      </View>
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => router.back()}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.backgroundMid + 'CC' }]} onPress={() => router.back()}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.backgroundMid, borderColor: colors.textOnBrand + '18', paddingBottom: bottomPad + 16 }]} onPress={(event) => event.stopPropagation()}>
            <View style={[styles.handle, { backgroundColor: colors.mutedOnBrand + '66' }]} />
            <Text style={[styles.plusTitle, { color: colors.textOnBrand }]}>Use 1 Skip the Line Pass?</Text>
            <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
              Simulated confirmation for {route || 'this flight'}. It does not guarantee a confirmed flight.
            </Text>
            <PrimaryButton
              label="Confirm — Use Skip the Line Pass"
              testID="demo-pass-confirm"
              disabled={demo.passBalance < 1 || entry.phase !== 'joined'}
              onPress={confirm}
            />
            <TouchableOpacity testID="demo-pass-cancel" onPress={() => router.back()} style={styles.cancel}>
              <Text style={[styles.body, { color: colors.mutedOnBrand }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function DemoPurchaseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemoJoinFlow();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  if (!demo.available || !demo.enabled) return <OffState />;
  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite }]} testID="demo-purchase-screen">
      <FloatingBackButton />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topPad + 72 }]}>
        <Text style={[styles.demoMark, { color: colors.primary }]}>DEMO</Text>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Skip the Line</Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          Purchase and upgrade actions are unavailable. No Apple Pay, StoreKit, or payment request is sent.
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator, borderWidth: 1 }]}>
          <Text style={[styles.plusTitle, { color: colors.textOnSurface }]}>1 Skip the Line Pass</Text>
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Simulated pass card. Price is not offered for purchase.</Text>
          <PrimaryButton label="Buy 1 Pass" disabled onPress={() => undefined} testID="demo-purchase-pass" />
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1.5 }]}>
          <Text style={[styles.demoMark, { color: colors.primary }]}>RECOMMENDED</Text>
          <Text style={[styles.plusTitle, { color: colors.textOnSurface }]}>Upgrade to Plus Membership</Text>
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Simulated membership card. Upgrade does not start a purchase.</Text>
          <PrimaryButton label="Upgrade to Plus" disabled onPress={() => undefined} testID="demo-purchase-upgrade" />
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <TouchableOpacity
          testID="demo-purchase-apple-pay"
          disabled
          accessibilityState={{ disabled: true }}
          style={[styles.applePay, { backgroundColor: '#000000' }]}
          onPress={() => undefined}
        >
          <Text style={styles.applePayText}>Pay</Text>
        </TouchableOpacity>
        <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>Apple Pay is shown only as a disabled visual treatment.</Text>
      </View>
    </View>
  );
}

function toDisplay(entry: DemoJoinEntry): JoinFlightDisplay {
  return {
    flightId: entry.flightId,
    fromAirport: entry.fromAirport,
    toAirport: entry.toAirport,
    fromCity: entry.fromCity,
    toCity: entry.toCity,
    departureDate: entry.departureDate,
    departureTime: entry.departureTime,
    aircraft: entry.aircraft,
    international: entry.international,
    flightStatus: entry.flightStatus,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { justifyContent: 'center', padding: 24, gap: 8 },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 33 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  demoMark: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.8 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, borderWidth: 1, padding: 16,
  },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 19 },
  footer: { paddingHorizontal: 22, paddingTop: 12, gap: 10 },
  statusFooter: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  hint: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center' },
  globe: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  feeRow: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.4 },
  feeValue: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  plusCard: { borderRadius: 17, borderWidth: 1, padding: 17, gap: 8 },
  plusTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  joinedBody: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 16 },
  countdown: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 23, textAlign: 'center' },
  ringWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { position: 'absolute', alignItems: 'center' },
  ringValue: { fontFamily: 'Inter_700Bold', fontSize: 32 },
  ringTotal: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  chipLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.5 },
  card: { width: '100%', borderRadius: 16, padding: 16, gap: 10 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  notice: { width: '100%', borderRadius: 14, padding: 14 },
  buyMore: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  buyMoreText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, paddingHorizontal: 22, paddingTop: 12, gap: 12 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 6 },
  cancel: { alignItems: 'center', paddingVertical: 8 },
  applePay: { height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: 0.45 },
  applePayText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
