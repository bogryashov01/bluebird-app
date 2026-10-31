import React, { useState } from 'react';
import {
  Linking, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  MEMBERSHIP_PAYMENT_WEBSITE_OPEN_ERROR,
  membershipPaymentWebsiteDestination,
  openMembershipPaymentWebsite,
} from '@/lib/membershipPaymentMethod';

const DESTINATION = membershipPaymentWebsiteDestination();

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [openError, setOpenError] = useState(false);
  const [opening, setOpening] = useState(false);

  const goToProfile = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile' as any);
    }
  };

  const openWebsite = async () => {
    if (opening) return;
    setOpening(true);
    setOpenError(false);
    const result = await openMembershipPaymentWebsite((url) => Linking.openURL(url));
    setOpening(false);
    if (result === 'unavailable') setOpenError(true);
  };

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.offWhite, paddingTop: topPad + 12, paddingBottom: insets.bottom },
      ]}
      testID="payment-methods-screen"
    >
      <TouchableOpacity
        onPress={goToProfile}
        style={[styles.backButton, { backgroundColor: colors.surface }]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Back to Profile"
        testID="payment-methods-back"
      >
        <Feather name="chevron-left" size={23} color={colors.textOnSurface} />
      </TouchableOpacity>

      <Text style={[styles.pageTitle, { color: colors.textOnSurface }]}>
        Payment Methods
      </Text>

      <View
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        testID="payment-methods-website"
      >
        <View style={[styles.iconTile, { backgroundColor: colors.muted }]}>
          <Feather name="credit-card" size={20} color={colors.primary} />
        </View>
        <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>
          Manage Your Payment Method
        </Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          Your membership payment method is securely managed through the Bluebird website. You can view or update your card details there.
        </Text>
        <TouchableOpacity
          onPress={() => { void openWebsite(); }}
          disabled={opening}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={DESTINATION.label}
          testID="payment-methods-open-website"
          style={[styles.button, { backgroundColor: colors.primary, opacity: opening ? 0.7 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            {DESTINATION.label}
          </Text>
          <Feather name="external-link" size={16} color={colors.primaryForeground} />
        </TouchableOpacity>
        <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>
          Your payment information is handled securely by Bluebird&apos;s payment provider.
        </Text>
        {openError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.note, { color: colors.mutedForegroundLight }]}
            testID="payment-methods-open-error"
          >
            {MEMBERSHIP_PAYMENT_WEBSITE_OPEN_ERROR}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 22,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  pageTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    lineHeight: 33,
    marginBottom: 20,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 10,
  },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  cardTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  button: {
    minHeight: 50,
    borderRadius: 999,
    marginTop: 6,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  note: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
});
