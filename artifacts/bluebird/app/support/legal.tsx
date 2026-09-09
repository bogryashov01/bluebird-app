import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

const TERMS_SECTIONS = [
  {
    h: '1. Membership',
    p: 'Bluebird memberships are personal and non-transferable. Your tier (Base, Plus, or Family/Corporate) determines the features available to you, including queue access, Skip the Line passes, and concierge services. Memberships renew annually and may be cancelled at any time; access continues through the end of the paid period.',
  },
  {
    h: '2. Empty-Leg Flights',
    p: 'Empty-leg flights are repositioning flights offered by third-party operators. Schedules, aircraft, and availability are set by operators and may change or be cancelled with limited notice. Bluebird facilitates access to these flights but does not operate aircraft.',
  },
  {
    h: '3. Queues & Passes',
    p: 'Queue positions are assigned in the order members join, except where a Skip the Line pass is used. Passes are non-refundable once applied to a queue. Confirmed seats are subject to operator confirmation and applicable safety requirements.',
  },
  {
    h: '4. Conduct',
    p: 'Members agree to follow all crew instructions, operator policies, and applicable aviation regulations. Bluebird may suspend accounts for misuse, abusive behavior, or violation of these terms.',
  },
  {
    h: '5. Liability',
    p: 'To the maximum extent permitted by law, Bluebird is not liable for delays, cancellations, or losses arising from operator schedule changes or events beyond our reasonable control.',
  },
];

const PRIVACY_SECTIONS = [
  {
    h: 'Information We Collect',
    p: 'We collect the information you provide when creating an account — your phone number (used to sign in), plus your name and optional email — along with your flight activity, queue history, and membership details, to operate the service.',
  },
  {
    h: 'How We Use It',
    p: 'Your information is used to manage your membership, confirm flights, send trip notifications, and improve the Bluebird experience. We do not sell your personal information.',
  },
  {
    h: 'Sharing',
    p: 'We share booking details with flight operators only as needed to confirm and operate your trips, and with service providers who help us run the platform under confidentiality obligations.',
  },
  {
    h: 'Your Choices',
    p: 'You can update your personal information in the app at any time, manage notification preferences, or contact support@bluebird.com to request deletion of your account and associated data.',
  },
];

export default function LegalScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [tab, setTab] = React.useState<'terms' | 'privacy'>('terms');

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const sections = tab === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Tab switcher */}
        <View style={[styles.tabs, { backgroundColor: colors.surface }]}>
          {(['terms', 'privacy'] as const).map((t) => {
            const active = tab === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.tab, active && { backgroundColor: colors.primary }]}
                onPress={() => setTab(t)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.tabText,
                  { color: active ? colors.primaryForeground : colors.mutedForegroundLight },
                ]}>
                  {t === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.updated, { color: colors.mutedForegroundLight }]}>Last updated: August 1, 2026</Text>

        {sections.map((s) => (
          <View key={s.h} style={styles.section}>
            <Text style={[styles.h, { color: colors.textOnSurface }]}>{s.h}</Text>
            <Text style={[styles.p, { color: colors.mutedForegroundLight }]}>{s.p}</Text>
          </View>
        ))}

        <Text style={[styles.footer, { color: colors.mutedForegroundLight }]}>
          Questions? Contact legal@bluebird.com
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 20 },
  tabs: {
    flexDirection: 'row', borderRadius: 999, padding: 4, marginBottom: 16,
  },
  tab: { flex: 1, borderRadius: 999, paddingVertical: 9, alignItems: 'center' },
  tabText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  updated: { fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 18 },
  section: { marginBottom: 18 },
  h: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 6 },
  p: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20 },
  footer: { fontFamily: 'Inter_400Regular', fontSize: 12.5, textAlign: 'center', marginTop: 10 },
});
