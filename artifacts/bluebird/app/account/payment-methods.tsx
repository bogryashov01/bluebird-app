import React from 'react';
import {
  Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const goToProfile = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile' as any);
    }
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
        testID="payment-methods-unavailable"
      >
        <View style={[styles.iconTile, { backgroundColor: colors.muted }]}>
          <Feather name="credit-card" size={20} color={colors.primary} />
        </View>
        <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>
          Payments are not available in the app
        </Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
          This version does not sell memberships or collect card details. Bluebird has not confirmed an in-app or website payment step for reviewers.
        </Text>
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
