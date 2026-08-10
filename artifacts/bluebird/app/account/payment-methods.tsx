import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { usePersistedState } from '@/hooks/usePersistedState';

interface MockCard {
  id: string;
  brand: string;
  last4: string;
  expiry: string;
  isDefault: boolean;
}

const INITIAL_CARDS: MockCard[] = [
  { id: 'c1', brand: 'Visa',       last4: '4242', expiry: '08/28', isDefault: true },
  { id: 'c2', brand: 'Mastercard', last4: '5100', expiry: '11/27', isDefault: false },
];

const NEW_CARD_POOL: Omit<MockCard, 'id' | 'isDefault'>[] = [
  { brand: 'Amex',       last4: '0005', expiry: '03/29' },
  { brand: 'Visa',       last4: '1881', expiry: '06/30' },
  { brand: 'Mastercard', last4: '4444', expiry: '01/29' },
];

const BRAND_COLORS: Record<string, string> = {
  Visa: '#1A1F71',
  Mastercard: '#EB001B',
  Amex: '#016FD0',
};

export default function PaymentMethodsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [cards, setCards] = usePersistedState<MockCard[]>('bluebird.paymentMethods', INITIAL_CARDS);
  const [addIdx, setAddIdx] = usePersistedState<number>('bluebird.paymentMethods.addIdx', 0);

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const setDefault = (id: string) =>
    setCards((prev) => prev.map((c) => ({ ...c, isDefault: c.id === id })));

  const removeCard = (card: MockCard) => {
    if (card.isDefault && cards.length > 1) {
      Alert.alert('Default card', 'Set another card as default before removing this one.');
      return;
    }
    Alert.alert(`Remove ${card.brand} •••• ${card.last4}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => setCards((prev) => prev.filter((c) => c.id !== card.id)),
      },
    ]);
  };

  const addCard = () => {
    const tpl = NEW_CARD_POOL[addIdx % NEW_CARD_POOL.length];
    setAddIdx((i) => i + 1);
    setCards((prev) => [
      ...prev,
      { ...tpl, id: `c${Date.now()}`, isDefault: prev.length === 0 },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Saved cards</Text>

        {cards.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForegroundLight }]}>
              No payment methods yet. Add a card to get started.
            </Text>
          </View>
        )}

        {cards.map((card) => (
          <View key={card.id} style={[styles.cardRow, { backgroundColor: colors.surface }]}>
            <View style={[styles.brandChip, { backgroundColor: (BRAND_COLORS[card.brand] ?? colors.primary) + '18' }]}>
              <Text style={[styles.brandChipText, { color: BRAND_COLORS[card.brand] ?? colors.primary }]}>
                {card.brand}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardNumber, { color: colors.textOnSurface }]}>•••• {card.last4}</Text>
              <Text style={[styles.cardExpiry, { color: colors.mutedForegroundLight }]}>Expires {card.expiry}</Text>
            </View>
            {card.isDefault ? (
              <View style={[styles.defaultBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.defaultBadgeText, { color: colors.primary }]}>Default</Text>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setDefault(card.id)} activeOpacity={0.7}>
                <Text style={[styles.actionText, { color: colors.primary }]}>Set default</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => removeCard(card)} activeOpacity={0.7} style={styles.removeBtn}>
              <Text style={styles.removeText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.addBtn, { borderColor: colors.primary }]}
          onPress={addCard}
          activeOpacity={0.8}
        >
          <Text style={[styles.addBtnText, { color: colors.primary }]}>+ Add payment method</Text>
        </TouchableOpacity>

        <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
          Demo wallet — cards shown here are sample data and are never charged.
        </Text>
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
  emptyCard: { borderRadius: 18, padding: 20, marginBottom: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13.5, textAlign: 'center' },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 18, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  brandChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  brandChipText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  cardNumber: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardExpiry: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  defaultBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  defaultBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  removeBtn: { paddingLeft: 4, paddingVertical: 4 },
  removeText: { fontSize: 14, color: '#DC2626' },
  addBtn: {
    borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed',
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  addBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', marginTop: 16 },
});
