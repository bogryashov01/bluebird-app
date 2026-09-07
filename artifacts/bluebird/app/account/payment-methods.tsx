import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Pressable, TextInput, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { usePersistedState } from '@/hooks/usePersistedState';
import { confirmDialog } from '@/lib/confirmDialog';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

interface MockCard {
  id: string;
  brand: CardBrand;
  last4: string;
  expiry: string;
  isDefault: boolean;
}

type CardBrand = 'Visa' | 'Mastercard' | 'Amex';

interface FormErrors {
  name?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
}

const INITIAL_CARDS: MockCard[] = [
  { id: 'c1', brand: 'Visa', last4: '4242', expiry: '08/28', isDefault: true },
  { id: 'c2', brand: 'Mastercard', last4: '5100', expiry: '11/27', isDefault: false },
];

const BRAND_COLORS: Record<CardBrand, string> = {
  Visa: '#1A1F71',
  Mastercard: '#EB001B',
  Amex: '#016FD0',
};

function detectBrand(number: string): CardBrand | null {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^3[47]/.test(digits)) return 'Amex';

  const firstFour = Number(digits.slice(0, 4));
  if (/^5[1-5]/.test(digits) || (digits.length >= 4 && firstFour >= 2221 && firstFour <= 2720)) {
    return 'Mastercard';
  }
  return null;
}

function passesLuhn(number: string): boolean {
  const digits = number.replace(/\D/g, '');
  let total = 0;
  let doubleDigit = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    doubleDigit = !doubleDigit;
  }
  return digits.length > 0 && total % 10 === 0;
}

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 19);
  const brand = detectBrand(digits);
  const groups = brand === 'Amex' ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const parts: string[] = [];
  let cursor = 0;

  groups.forEach((size) => {
    const part = digits.slice(cursor, cursor + size);
    if (part) parts.push(part);
    cursor += size;
  });
  return parts.join(' ');
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function expiryError(value: string): string | undefined {
  if (!/^\d{2}\/\d{2}$/.test(value)) return 'Enter expiration as MM/YY.';
  const [monthText, yearText] = value.split('/');
  const month = Number(monthText);
  const year = 2000 + Number(yearText);
  if (month < 1 || month > 12) return 'Enter a month from 01 to 12.';

  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return 'This card has expired.';
  }
  return undefined;
}

function cardNumberError(number: string, brand: CardBrand | null): string | undefined {
  const digits = number.replace(/\D/g, '');
  if (!digits) return 'Enter a card number.';
  if (!brand) return 'Use a Visa, Mastercard, or American Express card.';

  const validLength = brand === 'Amex'
    ? digits.length === 15
    : brand === 'Mastercard'
      ? digits.length === 16
      : [13, 16, 19].includes(digits.length);
  if (!validLength) return `Enter a valid ${brand} card number.`;
  if (!passesLuhn(digits)) return 'Check the card number and try again.';
  return undefined;
}

export default function PaymentMethodsScreen() {
  const { user } = useAuth();
  const colors = useColors();

  if (!user) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.emptyText, { color: colors.mutedForegroundLight }]}>
          Sign in to view payment methods.
        </Text>
      </View>
    );
  }

  // The key forces a fresh wallet instance if a different member signs in
  // without this route being unmounted.
  return <PaymentMethodsWallet key={user.id} userId={user.id} />;
}

function PaymentMethodsWallet({ userId }: { userId: string }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [cards, setCards] = usePersistedState<MockCard[]>(
    `bluebird.paymentMethods.${userId}`,
    INITIAL_CARDS,
  );
  const [modalOpen, setModalOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [number, setNumber] = React.useState('');
  const [expiry, setExpiry] = React.useState('');
  const [cvc, setCvc] = React.useState('');
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const successTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const brand = detectBrand(number);

  const showSuccess = (message: string) => {
    if (successTimer.current) clearTimeout(successTimer.current);
    setSuccessMessage(message);
    successTimer.current = setTimeout(() => setSuccessMessage(null), 3000);
  };

  const resetForm = () => {
    setName('');
    setNumber('');
    setExpiry('');
    setCvc('');
    setErrors({});
  };

  const closeModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const setDefault = (id: string) => {
    setCards((prev) => prev.map((card) => ({ ...card, isDefault: card.id === id })));
    showSuccess('Default payment method updated.');
  };

  const removeCard = async (card: MockCard) => {
    const accepted = await confirmDialog(
      `Remove ${card.brand} •••• ${card.last4}?`,
      card.isDefault && cards.length > 1
        ? 'This is your default card. Another saved card will become the default.'
        : 'This card will be removed from your demo wallet.',
      'Remove',
      true,
    );
    if (!accepted) return;

    setCards((prev) => {
      const remaining = prev.filter((item) => item.id !== card.id);
      if (card.isDefault && remaining.length > 0) {
        return remaining.map((item, index) => ({ ...item, isDefault: index === 0 }));
      }
      return remaining;
    });
    showSuccess('Payment method removed.');
  };

  const addCard = () => {
    const digits = number.replace(/\D/g, '');
    const nextErrors: FormErrors = {
      name: name.trim().length < 2 ? 'Enter the cardholder’s full name.' : undefined,
      number: cardNumberError(number, brand),
      expiry: expiryError(expiry),
      cvc: !/^\d+$/.test(cvc)
        ? 'Enter the security code.'
        : cvc.length !== (brand === 'Amex' ? 4 : 3)
          ? `${brand === 'Amex' ? 'American Express' : 'This card'} uses a ${brand === 'Amex' ? '4' : '3'}-digit code.`
          : undefined,
    };

    if (Object.values(nextErrors).some(Boolean) || !brand) {
      setErrors(nextErrors);
      return;
    }

    setCards((prev) => [
      ...prev,
      {
        id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        brand,
        last4: digits.slice(-4),
        expiry,
        isDefault: prev.length === 0,
      },
    ]);
    closeModal();
    showSuccess(`${brand} ending in ${digits.slice(-4)} added.`);
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: colors.input, color: colors.textOnSurface, borderColor: colors.border },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Saved cards</Text>

        {successMessage && (
          <View style={[styles.successBanner, { backgroundColor: colors.success + '18' }]}>
            <Text style={[styles.successText, { color: colors.success }]}>✓ {successMessage}</Text>
          </View>
        )}

        {cards.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForegroundLight }]}>
              No payment methods yet. Add a card to get started.
            </Text>
          </View>
        )}

        {cards.map((card) => (
          <View key={card.id} style={[styles.cardRow, { backgroundColor: colors.surface }]}>
            <View style={[styles.brandChip, { backgroundColor: BRAND_COLORS[card.brand] + '18' }]}>
              <Text style={[styles.brandChipText, { color: BRAND_COLORS[card.brand] }]}>
                {card.brand}
              </Text>
            </View>
            <View style={styles.cardDetails}>
              <Text style={[styles.cardNumber, { color: colors.textOnSurface }]}>•••• {card.last4}</Text>
              <Text style={[styles.cardExpiry, { color: colors.mutedForegroundLight }]}>Expires {card.expiry}</Text>
            </View>
            {card.isDefault ? (
              <View style={[styles.defaultBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.defaultBadgeText, { color: colors.primary }]}>Default</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setDefault(card.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`set-default-${card.id}`}
              >
                <Text style={[styles.actionText, { color: colors.primary }]}>Set default</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => removeCard(card)}
              activeOpacity={0.7}
              style={styles.removeBtn}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${card.brand} ending in ${card.last4}`}
              testID={`remove-card-${card.id}`}
            >
              <Text style={[styles.removeText, { color: colors.destructive }]}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.addBtn, { borderColor: colors.primary }]}
          onPress={() => setModalOpen(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          testID="add-payment-method"
        >
          <Text style={[styles.addBtnText, { color: colors.primary }]}>+ Add payment method</Text>
        </TouchableOpacity>

        <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
          Demo wallet — no payment integration is connected and cards are never charged.
        </Text>
      </ScrollView>

      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdrop}
            onPress={closeModal}
            accessibilityLabel="Cancel adding card"
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                paddingBottom: botPad + 12,
                marginTop: Platform.OS === 'web' ? 67 : insets.top + 12,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleWrap}>
                <Text style={[styles.sheetTitle, { color: colors.textOnSurface }]}>Add a card</Text>
                <Text style={[styles.sheetSubtitle, { color: colors.mutedForegroundLight }]}>
                  For this prototype only
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeModal}
                style={[styles.closeButton, { backgroundColor: colors.input }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="cancel-add-card"
              >
                <Text style={[styles.closeText, { color: colors.textOnSurface }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <KeyboardAwareScrollViewCompat
              contentContainerStyle={styles.form}
              bottomOffset={64}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Cardholder name</Text>
              <TextInput
                style={[...inputStyle, errors.name && { borderColor: colors.destructive }]}
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                placeholder="Name on card"
                placeholderTextColor={colors.mutedForegroundLight}
                autoCapitalize="words"
                autoComplete="cc-name"
                returnKeyType="next"
                testID="cardholder-name-input"
              />
              {errors.name && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.name}</Text>}

              <View style={styles.labelRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Card number</Text>
                {brand && <Text style={[styles.detectedBrand, { color: colors.primary }]}>{brand}</Text>}
              </View>
              <TextInput
                style={[...inputStyle, errors.number && { borderColor: colors.destructive }]}
                value={number}
                onChangeText={(value) => {
                  setNumber(formatCardNumber(value));
                  setErrors((prev) => ({ ...prev, number: undefined, cvc: undefined }));
                }}
                placeholder="1234 5678 9012 3456"
                placeholderTextColor={colors.mutedForegroundLight}
                keyboardType="number-pad"
                autoComplete="cc-number"
                returnKeyType="next"
                testID="card-number-input"
              />
              {errors.number && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.number}</Text>}

              <View style={styles.fieldPair}>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Expiration</Text>
                  <TextInput
                    style={[...inputStyle, errors.expiry && { borderColor: colors.destructive }]}
                    value={expiry}
                    onChangeText={(value) => {
                      setExpiry(formatExpiry(value));
                      setErrors((prev) => ({ ...prev, expiry: undefined }));
                    }}
                    placeholder="MM/YY"
                    placeholderTextColor={colors.mutedForegroundLight}
                    keyboardType="number-pad"
                    autoComplete="cc-exp"
                    maxLength={5}
                    testID="card-expiry-input"
                  />
                  {errors.expiry && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.expiry}</Text>}
                </View>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>CVC</Text>
                  <TextInput
                    style={[...inputStyle, errors.cvc && { borderColor: colors.destructive }]}
                    value={cvc}
                    onChangeText={(value) => {
                      setCvc(value.replace(/\D/g, '').slice(0, 4));
                      setErrors((prev) => ({ ...prev, cvc: undefined }));
                    }}
                    placeholder={brand === 'Amex' ? '4 digits' : '3 digits'}
                    placeholderTextColor={colors.mutedForegroundLight}
                    keyboardType="number-pad"
                    autoComplete="cc-csc"
                    secureTextEntry
                    maxLength={4}
                    testID="card-cvc-input"
                  />
                  {errors.cvc && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.cvc}</Text>}
                </View>
              </View>

              <Text style={[styles.privacyNote, { color: colors.mutedForegroundLight }]}>
                Only the card brand, last four digits, and expiration are saved on this device.
                The full card number and CVC are discarded.
              </Text>

              <View style={styles.formActions}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={closeModal}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.textOnSurface }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.primary }]}
                  onPress={addCard}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  testID="save-card"
                >
                  <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Add card</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAwareScrollViewCompat>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
  },
  successBanner: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12 },
  successText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  emptyCard: { borderRadius: 18, padding: 20, marginBottom: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13.5, textAlign: 'center' },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 18, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  cardDetails: { flex: 1 },
  brandChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  brandChipText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  cardNumber: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardExpiry: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  defaultBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  defaultBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  removeBtn: { paddingLeft: 4, paddingVertical: 4 },
  removeText: { fontSize: 14 },
  addBtn: {
    borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed',
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  addBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', marginTop: 16 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  sheet: {
    width: '100%', maxWidth: 560, maxHeight: '92%',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
  },
  sheetTitleWrap: { flex: 1 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  sheetSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 12.5, marginTop: 2 },
  closeButton: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: 15 },
  form: { paddingHorizontal: 20, paddingBottom: 8 },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11.5,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7,
  },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detectedBrand: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  input: {
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 13,
    fontFamily: 'Inter_500Medium', fontSize: 15,
    marginBottom: 16,
  },
  errorText: {
    fontFamily: 'Inter_500Medium', fontSize: 11.5,
    lineHeight: 16, marginTop: -10, marginBottom: 14,
  },
  fieldPair: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },
  privacyNote: { fontFamily: 'Inter_400Regular', fontSize: 11.5, lineHeight: 17, marginTop: 2 },
  formActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  saveBtn: { flex: 1, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});