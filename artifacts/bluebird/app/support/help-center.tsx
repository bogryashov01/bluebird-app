import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';

interface FaqItem { q: string; a: string }
interface FaqTopic { title: string; items: FaqItem[] }

const TOPICS: FaqTopic[] = [
  {
    title: 'Flights & Booking',
    items: [
      {
        q: 'What is an empty-leg flight?',
        a: 'When a private jet flies without passengers to reposition for its next charter, those seats become available at a steep discount. Bluebird surfaces these empty legs so members can book them.',
      },
      {
        q: 'How does the queue work?',
        a: 'Each flight has a waitlist queue. Join the queue for any flight you want, and as seats are confirmed you move up. When you reach the front, the seat is yours and the trip is confirmed.',
      },
      {
        q: 'What is a Skip the Line pass?',
        a: 'A Skip the Line pass moves you to the front of a flight queue instantly. Plus members receive 2 per month; Concierge members have unlimited passes.',
      },
      {
        q: 'Can I bring guests?',
        a: 'Plus and Concierge members can add guests when joining a queue, subject to seat availability on the aircraft.',
      },
    ],
  },
  {
    title: 'Membership & Billing',
    items: [
      {
        q: 'How do I upgrade my membership?',
        a: 'Open the Membership tab and choose the plan you want. Upgrades take effect immediately, including any bonus Skip the Line passes.',
      },
      {
        q: 'When am I billed?',
        a: 'Membership renews monthly on the date you joined. You can review your renewal date in the Membership tab.',
      },
      {
        q: 'Can I cancel anytime?',
        a: 'Yes. Memberships are month-to-month and can be cancelled at any time; access continues through the end of the billing period.',
      },
    ],
  },
  {
    title: 'Account & Security',
    items: [
      {
        q: 'How do I update my personal details?',
        a: 'Go to Profile → Personal Information to edit your name, email, and phone number.',
      },
      {
        q: 'How do referrals work?',
        a: 'Share your referral code from the Referral screen. When a friend joins with your code, you both receive rewards.',
      },
    ],
  },
];

export default function HelpCenterScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {TOPICS.map((topic) => (
          <View key={topic.title}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>{topic.title}</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {topic.items.map((item, i) => {
                const id = `${topic.title}-${i}`;
                const open = openId === id;
                return (
                  <View
                    key={id}
                    style={i < topic.items.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.separator } : undefined}
                  >
                    <TouchableOpacity
                      style={styles.qRow}
                      activeOpacity={0.6}
                      onPress={() => setOpenId(open ? null : id)}
                    >
                      <Text style={[styles.qText, { color: colors.textOnSurface }]}>{item.q}</Text>
                      <Text style={[styles.qChevron, { color: colors.mutedForegroundLight }]}>{open ? '−' : '+'}</Text>
                    </TouchableOpacity>
                    {open && (
                      <Text style={[styles.aText, { color: colors.mutedForegroundLight }]}>{item.a}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View style={[styles.contactCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.contactTitle, { color: colors.textOnSurface }]}>Still need help?</Text>
          <Text style={[styles.contactBody, { color: colors.mutedForegroundLight }]}>
            Ask the AI Concierge anytime, or email us at support@bluebird.com.
          </Text>
          <TouchableOpacity
            style={[styles.contactBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
            onPress={() => router.push('/concierge')}
          >
            <Text style={styles.contactBtnText}>Chat with AI Concierge</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
  },
  card: {
    borderRadius: 18, overflow: 'hidden', marginBottom: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  qRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  qText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14.5 },
  qChevron: { fontFamily: 'Inter_600SemiBold', fontSize: 18, lineHeight: 20 },
  aText: {
    fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20,
    paddingHorizontal: 16, paddingBottom: 14, marginTop: -4,
  },
  contactCard: { borderRadius: 18, padding: 20 },
  contactTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 6 },
  contactBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19, marginBottom: 14 },
  contactBtn: { borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  contactBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
});
