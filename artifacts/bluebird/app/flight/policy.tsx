import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';

const POLICY_SECTIONS = [
  {
    title: 'Empty Leg Flight Policy',
    body: 'Empty leg flights are repositioning trips that occur when a private aircraft needs to return to its base or fly to pick up a new charter client. These flights are offered to Bluebird members at no cost as a perk of membership.',
  },
  {
    title: 'Queue System',
    body: 'Members join a queue for each desired flight. When a seat becomes available and you are at the front of the queue, your seat is confirmed automatically and you will receive a confirmation notification — no action is needed and your spot never expires.',
  },
  {
    title: 'Skip the Line Passes',
    body: 'Skip the Line passes allow Plus and Concierge members to move to the front of the queue for any flight. Passes are non-refundable and expire at the end of each membership cycle.',
  },
  {
    title: 'Flight Modifications',
    body: 'Empty leg flights are subject to change or cancellation by the aircraft operator without notice. Bluebird will notify members of any changes as soon as possible. Cancelled flights do not consume Skip the Line passes.',
  },
  {
    title: 'International Flights',
    body: 'International empty leg flights require a valid passport and may require additional documentation. Members are responsible for meeting all immigration requirements of the destination country.',
  },
  {
    title: 'Luggage & Capacity',
    body: 'Luggage is subject to the aircraft\'s weight and space limitations. Each aircraft type has different capacity constraints. Bluebird will communicate specific luggage allowances upon flight confirmation.',
  },
];

export default function FlightPolicyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.introCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
          <Feather name="info" size={20} color={colors.primary} />
          <Text style={[styles.introText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
            Empty leg flights are free perks of Bluebird membership. Please read the terms below before joining a queue.
          </Text>
        </View>

        {POLICY_SECTIONS.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {section.body}
            </Text>
          </View>
        ))}

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Text style={[styles.footerText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Last updated: August 2026 · Bluebird Aviation Inc.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 20 },
  introCard: {
    flexDirection: 'row', gap: 12, padding: 16,
    borderRadius: 14, borderWidth: 1, alignItems: 'flex-start',
  },
  introText: { flex: 1, fontSize: 14, lineHeight: 20 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16 },
  sectionBody: { fontSize: 14, lineHeight: 22 },
  footer: { borderTopWidth: 1, paddingTop: 16 },
  footerText: { fontSize: 12, textAlign: 'center' },
});
